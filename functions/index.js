const {defineSecret, defineString, defineBoolean} = require("firebase-functions/params");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const request = require("request");
const {Timestamp} = require("firebase-admin/firestore");
const crypto = require("crypto")

const apis = express();
const gitapis = express();
gitapis.use(cors({origin: true}));

const appCheck = defineBoolean("APP_CHECK");
if(appCheck.value()) {
  apis.options('/get_projs', cors({origin: "https://avi-portfolio.net"}))
  apis.use(cors({origin: "https://avi-portfolio.net"}))
} else{
  apis.use(cors({origin: true}));
}

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
const signKey = defineString("GIT_HOOK_KEY");
const collectionName = "projs";

function appCheckVerification(req, res) {
  return new Promise((resolve, rejects) => {
    const appCheckToken = req.header('X-Firebase-AppCheck');
  
    if (!appCheckToken) {
      res.status(401).send({error: 'Unautorized'});
    }
  
    const secret = defineString('CAPTCHA_SECRET');
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

// Make GitHub call to pull data
function pullRepoData(gitProjName){
  return new Promise((resolve, reject) => {
    Promise.all([update_langs(gitProjName), update_readme(gitProjName)]).then(result => {
      let langs = result[0];
      let readme = result[1];
  
      //Update to DB
      admin.firestore().collection(collectionName).doc(gitProjName).update({
        langs: langs, 
        readme: readme, 
        lu: Timestamp.fromDate(new Date())
      });
  
      resolve(true);
    }).catch(err => {
      functions.logger.error('Error while updating project details' + gitProjName, err);
      reject(false);
    })
  })
}

function verifySignature(req){
  let sign = Buffer.from(req.header('X-Hub-Signature-256'), 'utf8');

  let hmac = crypto.createHmac('sha256', signKey.value());
  let bodySign = Buffer.from(('sha256=' + hmac.update(toString(req.body)).digest('hex')), 'utf8');

  if(bodySign.length != sign.length && !crypto.timingSafeEqual(sign, digest)){
    return false;
  }

  return true;
}

gitapis.post('/update_data', (req, res) => {
  if(req.header('X-Hub-Signature-256') == null) return res.status(403).send('Signature not found');

  if(verifySignature(req)){
    // Check if pull request is closed
    if(req.body.action == 'closed'){
      pullRepoData(req.body.repository.name).then(succ => {
        res.status(200).json('okay');
      }).catch(fail => {
        res.status(500).json('Failed to update repository information.')
      });
    }else{
      res.status(200).json('Ping response');
    }
  }else{
    res.status(403).json("Signature didn't match.");
  }
});

function getProjData(req, res){
  res.header('Access-Control-Allow-Origin', 'https://avi-portfolio.net');

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
      res.status(401).send('Verification failed')
    });
  }else{
    getProjData(req, res);
  }
})

exports.gitapis = functions.runWith({secrets: ['GIT_PERSONAL_TOKEN']}).https.onRequest(gitapis);
exports.apis = functions.https.onRequest(apis);