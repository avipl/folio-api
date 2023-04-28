const { defineSecret, projectID } = require("firebase-functions/params");

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const express = require('express')
const cors = require('cors')
const request = require('request');
const { promises } = require("dns");
const { resolve } = require("path");
const { rejects } = require("assert");
const { Timestamp } = require("firebase-admin/firestore");

const apis = express()

apis.use(cors({origin: true}))
admin.initializeApp();

const git_token = defineSecret('GIT_PERSONAL_TOKEN')
const collection_name = 'projs'

function update_readme(git_proj_name){
    return new Promise((resolve, rejects) => { 
        request({
            "method": 'GET',
            "url": 'https://api.github.com/repos/avipl/' + git_proj_name + '/readme',
            "headers": {
                'Accept': 'application/vnd.github.html+json',
                'Authorization': 'Bearer ' + git_token.value(),
                'User-Agent': functions.firebaseConfig().projectId + '/1.0'
            }
        }, function(error, response, body){
            if(!error && response.statusCode == 200){
                resolve(body)
            }else{
                functions.logger.error('Error getting readme for project' + git_proj_name, body)
                rejects(error)
            }
        })
    })
}

function convert_to_perc(langs){
    let total = 0;
    Object.keys(langs).forEach((key) => {
        total += langs[key]
    })
    Object.keys(langs).forEach((key) => {
        langs[key] = parseInt(langs[key]/total * 100)
    })

    return langs
}

function update_langs(git_proj_name){
    return new Promise((resolve, rejects) => {
        request({
            "method": 'GET',
            "url": 'https://api.github.com/repos/avipl/' + git_proj_name + '/languages',
            "headers": {
                'Accept': 'application/vnd.github+json',
                'Authorization': 'Bearer ' + git_token.value(),
                'User-Agent': functions.firebaseConfig().projectId + '/1.0'
            }
        }, function(error, response, body){
            if(!error && response.statusCode == 200){
                let lang = JSON.parse(body)
                if(Object.keys(lang).length){
                    lang = convert_to_perc(lang)
                }
                resolve(lang)
            }else{
                functions.logger.error('Error getting languages for project' + git_proj_name, body)
                rejects(error)
            }
        })
    })
}

exports.update_proj_details = functions.runWith({ secrets: ['GIT_PERSONAL_TOKEN']}).https.onRequest((req, res) => {
    if(!('git_proj_name' in req.query)){
        functions.logger.info('Error while updating project details' + git_proj_name, err)
        res.status(400).send('Missing parameter git_proj_name')
    }
    let git_proj_name = req.query.git_proj_name

    Promise.all([update_langs(git_proj_name), update_readme(git_proj_name)]).then(result => {
        let langs = result[0]
        let readme = result[1]

        //Update to DB
        admin.firestore().collection(collection_name).doc(git_proj_name).update({
            langs: langs, 
            readme: readme, 
            lu: Timestamp.fromDate(new Date())
        })

        res.status(200).json({response: 'okay'})
    }).catch(err => {
        functions.logger.error('Error while updating project details' + git_proj_name, err)
        res.status(500).send(err)
    })
})

apis.get('/get_projs', (req, res) => {
    const result_prom = admin.firestore().collection(collection_name).get()

    result_prom.then(result =>{
        if(result.size){
            let data = {}
            result.docs.forEach(doc => {
                let id = doc.get('id')

                data[id] = {
                    id: id,
                    langs: doc.get('langs'),
                    pname: doc.get('pname'),
                    lu: doc.get('lu').toDate(),
                    readme: doc.get('readme'),
                    snap: doc.get('snap'),
                    title: doc.get('title')
                }
            });

            res.json(data)
        }else{
            res.status(404).json({Msg: 'No project details'});
        }
    }).catch(err => {
        functions.logger.error('Error fetching data ', err)
        res.status(500).json({error: 'Error while fetching course projects.'});
    })
})

exports.apis = functions.https.onRequest(apis);