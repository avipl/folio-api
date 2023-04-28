const {defineSecret, defineString, defineBoolean} = require("firebase-functions/params");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const request = require("request");
const {Timestamp} = require("firebase-admin/firestore");
const { rejects } = require("assert");
const { error } = require("console");

const apis = express();
const appCheck = defineBoolean("APP_CHECK");
apis.use(cors({origin: true}));

// if(appCheck) {
//   apis.use(cors({origin: ["avi-portfolio.net", "localhost:5173"]}))
// } else{
//   apis.use(cors({origin: true}));
// }

const apiKey = defineString("API_KEY");
const authDomain = defineString("AUTH_DOMAIN");
const storageBucket = defineString("STORAGE_BUCKET");
const messagingSenderId = defineString("MESSAGING_SENDER_ID");
const appId = defineString("APP_ID");
const firebaseConfig = {
  apiKey: apiKey,
  authDomain: authDomain,
  projectId: functions.firebaseConfig().projectId,
  storageBucket: storageBucket,
  messagingSenderId: messagingSenderId,
  appId: appId,
};
admin.initializeApp(firebaseConfig);

const gitToken = defineSecret("GIT_PERSONAL_TOKEN");
const collectionName = "projs";

function appCheckVerification(req, res) {
  return new Promise((resolve, rejects) => {
    const appCheckToken = req.header('X-Firebase-AppCheck');
  
    if (!appCheckToken) {
      res.status(401).send({error: 'Unautorized'});
    }
  
    const secret = '6LfFIsQlAAAAAFUTWakDGSxzJCTKgf8nOGca4SoG';
    request({
      "method": 'POST',
      "url": 'https://recaptcha.google.com/recaptcha/api/siteverify',
      "headers": {
          'User-Agent': functions.firebaseConfig().projectId + '/1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `secret=${secret}&response=${appCheckToken}`
    }, function(error, response, body){
      if(!error && response.statusCode == 200){
        body = JSON.parse(body)
        if(body.success && body.score > 0.5) resolve(body.score)
        else rejects({error: 'Captcha verification failed.'})
      }else{
          rejects({error: 'Error during captcha verification.'});
      }
    })
  })
}

function update_readme(gitProjName) {
  return new Promise((resolve, rejects) => {
    request({
      "method": 'GET',
      "url": 'https://api.github.com/repos/avipl/' + gitProjName + '/readme',
      "headers": {
          'Accept': 'application/vnd.github.html+json',
          'Authorization': 'Bearer ' + gitToken.value(),
          'User-Agent': functions.firebaseConfig().projectId + '/1.0',
      }
    }, function(error, response, body){
      if(!error && response.statusCode == 200){
          resolve(body);
      }else{
          functions.logger.error('Error getting readme for project' + gitProjName, body);
          rejects(error);
      }
    })
  })
}

function convert_to_perc(langs) {
  let total = 0;
  Object.keys(langs).forEach((key) => {
    total += langs[key];
  });
  Object.keys(langs).forEach((key) => {
    langs[key] = parseInt(langs[key]/total * 100);
  });

  return langs;
}

function update_langs(gitProjName) {
  return new Promise((resolve, rejects) => {
    request({
      "method": 'GET',
      "url": 'https://api.github.com/repos/avipl/' + gitProjName + '/languages',
      "headers": {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + gitToken.value(),
        'User-Agent': functions.firebaseConfig().projectId + '/1.0'
      }
    }, function(error, response, body) {
      if(!error && response.statusCode == 200){
        let lang = JSON.parse(body);
        if(Object.keys(lang).length){
          lang = convert_to_perc(lang);
        }
        resolve(lang);
      }else{
        functions.logger.error('Error getting languages for project' + gitProjName, body);
        rejects(error);
      }
    })
  })
}

exports.update_proj_details = functions.runWith({ secrets: ['GIT_PERSONAL_TOKEN'] }).https.onRequest((req, res) => {
  if(!('gitProjName' in req.query)) {
    res.status(400).send('Missing parameter gitProjName');
  }
  let gitProjName = req.query.gitProjName;

  Promise.all([update_langs(gitProjName), update_readme(gitProjName)]).then(result => {
    let langs = result[0];
    let readme = result[1];

    //Update to DB
    admin.firestore().collection(collectionName).doc(gitProjName).update({
      langs: langs, 
      readme: readme, 
      lu: Timestamp.fromDate(new Date())
    });

    res.status(200).json({response: 'okay'});
  }).catch(err => {
    functions.logger.error('Error while updating project details' + gitProjName, err);
    res.status(500).send(err);
  })
})

function getProjData(req, res){
  const result_prom = admin.firestore().collection(collectionName).get();
  result_prom.then(result => {
    if(result.size){
      let data = {};
      result.docs.forEach(doc => {
        let id = doc.get('id');

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

      res.json(data);
    }else{
      res.status(404).json({Msg: 'No project details'});
    }
  }).catch(err => {
    functions.logger.error('Error fetching data ', err);
    res.status(500).json({error: 'Error while fetching course projects.'});
  })
}

apis.get('/get_projs', (req, res) => {
  if(appCheck.value()){
    appCheckVerification(req, res).then(success => {
      getProjData(req, res);
    }).catch(err => {
      functions.logger.warn('Failed captcha verification.', err)
      console.log(err)
      res.status(401).send('Verification failed')
    });
  }else{
    getProjData(req, res);
  }
})

exports.apis = functions.https.onRequest(apis);