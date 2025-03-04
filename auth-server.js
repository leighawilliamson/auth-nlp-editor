/*
 *
 * Copyright 2022 Elyra Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const fileupload = require('express-fileupload');
const cors = require('cors');
const AdmZip = require('adm-zip');
const rateLimit = require('express-rate-limit');
const xssFilters = require('xss-filters');
const helmet = require('helmet');
const { body, checkSchema, validationResult } = require('express-validator');

// --------------------- require modules needed for authentication
require('dotenv').config();
const session = require('express-session'); // https://www.npmjs.com/package/express-session
const passport = require('passport'); // https://www.npmjs.com/package/passport
const WebAppStrategy = require('ibmcloud-appid').WebAppStrategy; // https://www.npmjs.com/package/ibmcloud-appid
// -----------------------

app.use(cors());
app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: 'preload' }));
app.use(fileupload());
const jsonParser = express.json();
app.use(jsonParser);

// --------------------- initialize for authentication
app.use(
  session({
    secret: '123456',
    resave: true,
    saveUninitialized: true,
  }),
);
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, cb) => cb(null, user));
passport.deserializeUser((user, cb) => cb(null, user));

let appId_tenantId = process.env.APPID_TENANT_ID;
let appId_clientId = process.env.APPID_CLIENT_ID;
let appId_secret = process.env.APPID_SECRET;
let appId_oauthServerUrl = process.env.APPID_OAUTH_SERVER_URL;
let appId_redirectUri = process.env.APPID_REDIRECT_URI;
const port = process.env.PORT || 8080;

let user = {
  name: '',
  email: '',
};

passport.use(
  new WebAppStrategy({
    tenantId: appId_tenantId,
    clientId: appId_clientId,
    secret: appId_secret,
    oauthServerUrl: appId_oauthServerUrl,
    redirectUri: appId_redirectUri,
  }),
);

// Handle Login
app.get(
  '/appid/login',
  passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
    successRedirect: '/',
    forceLogin: true,
  }),
);

// Handle callback
app.get('/appid/callback', passport.authenticate(WebAppStrategy.STRATEGY_NAME));

// Handle logout
app.get('/appid/logout', function (req, res) {
  WebAppStrategy.logout(req);
  res.redirect('/');
});

// Protect the whole app
app.use(passport.authenticate(WebAppStrategy.STRATEGY_NAME));

// The /api/user API used to retrieve name of a currently logged in user
app.get('/api/user', (req, res) => {
  console.log(req.session[WebAppStrategy.AUTH_CONTEXT]);
  res.json({
    user: {
      name: req.user.name,
      email: req.user.email,
    },
  });
});
// ----------------------- end of authentication setup

app.use(express.static(path.join(__dirname, 'build')));

//we temporarily store files here before zipping
const tempFolder = __dirname + '/temp';

//path required by SystemT runtime
//const systemTdataFolder = `/app/Seer-Core/aql-processor`;
const systemTdataFolder = `${__dirname}/Seer-Core/aql-processor`;

//for debugging purpose, implementation assumes single user, single invokation
//need to change to use session when scaling ex: running on multiple pods
let systemTStartTime = undefined;

const createFolder = (folderName) => {
  console.log(`creating folder ${folderName}`);
  try {
    if (!fs.existsSync(folderName)) {
      fs.mkdirSync(folderName);
    }
  } catch (error) {
    //TODO properly log error
    console.log(error);
    return { error, message: `Unable to create folder ${folderName}.` };
  }
};

const uploadFile = (path, file, filename = 'payload.txt') => {
  console.log(`uploading file to temp folder ${file.name}`);
  //we rename the file, the runtime will look for input.txt
  const uploadPath = `${path}/${filename}`;
  return new Promise((resolve, reject) => {
    file.mv(uploadPath, (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
};

const createFile = (path, fileName, contents) => {
  console.log(`creating file ${fileName}`);
  fs.writeFileSync(`${path}/${fileName}`, contents);
};

const createZipArchive = async (tmpFolder, fileName) => {
  console.log(`creating zipfile ${fileName}`);
  const zip = new AdmZip();
  zip.addLocalFolder(tmpFolder);
  zip.writeZip(`${tmpFolder}/${fileName}`);
};

const moveZipFile = (tmpFolder, fileName) => {
  const currentPath = `${tmpFolder}/${fileName}`;
  const destinationPath = `${systemTdataFolder}/user-data-in/${fileName}`;
  fs.rename(currentPath, destinationPath, function (err) {
    if (err) {
      console.log(`error moving zipfile ${fileName}`);
      throw err;
    } else {
      console.log(`moved zipfile ${fileName} to be processed.`);
    }
  });
};

app.post('/api/upload', async (req, res) => {
  const { workingId } = req.body;
  const safeWorkingId = xssFilters.inHTMLData(workingId);
  console.log(`uploading files to ${workingId}`);
  const filesToUpload = req.files.attach_file;

  //create a tmp folder to work in, if it does not exists
  createFolder(tempFolder);
  //create working folder for this session.
  const workingFolder = `${tempFolder}/${safeWorkingId}`;
  createFolder(workingFolder);

  try {
    if (filesToUpload.length > 0) {
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        await uploadFile(workingFolder, file);
      }
    } else {
      await uploadFile(workingFolder, req.files.attach_file);
    }
    res.status(200).send({ message: 'Files Uploaded' });
  } catch (e) {
    console.error(e);
    res.status(500).send({ message: 'File upload failed' });
  }
});

app.post(
  '/api/run',
  [
    body('workingId').matches(/^[a-zA-Z0-9-]+$/),
    body('language').matches(/^[a-zA-Z-]+$/),
    body('exportPipeline').matches(/^true|false$/),
    checkSchema({
      payload: {
        custom: {
          options: (data) => JSON.parse(data),
          errorMessage: 'Invalid JSON',
        },
      },
    }),
  ],
  rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false,
  }),
  async (req, res) => {
    try {
      validationResult(req).throw();
    } catch (err) {
      return res.status(400).json(err);
    }

    console.log('executing pipeline');
    const { workingId, language, exportPipeline } = req.body;
    const payload = JSON.parse(req.body.payload);
    const safeWorkingId = xssFilters.inHTMLData(workingId);

    //create a tmp folder to work in, if it does not exist
    createFolder(tempFolder);
    //create working folder for this session.
    const workingFolder = `${tempFolder}/${safeWorkingId}`;
    createFolder(workingFolder);

    //Upload the input file
    await req.files.file.mv(`${workingFolder}/payload.txt`);

    console.time('writing xml files');
    fs.readdirSync(workingFolder)
      .filter((f) => f.endsWith('.xml'))
      .forEach((f) => fs.unlinkSync(`${workingFolder}/${f}`));

    //write files to temp folder
    payload.forEach((node) => {
      const { label, xml } = node;
      createFile(workingFolder, `${label}.xml`, xml);
    });
    console.timeEnd('writing xml files');

    // Create file to indicate language.
    createFile(workingFolder, 'language-name.txt', language);

    // Add additional export file for exporting.
    if (exportPipeline === 'true') {
      console.log(`creating file ${safeWorkingId}.export-aql`);
      createFile(workingFolder, `${safeWorkingId}.export-aql`, '');
    }

    //zip tempfolder
    console.time('creating+moving zip file');
    const zipFileName = `${safeWorkingId}.zip`;
    createZipArchive(workingFolder, zipFileName);

    //move zipfile to be executed
    moveZipFile(workingFolder, zipFileName);
    systemTStartTime = new Date().getTime(); //debugging instrumentation
    console.timeEnd('creating+moving zip file');

    //read document to render in UI
    const docPath = `${workingFolder}/payload.txt`;
    const document = fs.readFileSync(docPath, 'utf8');
    fs.rmSync(workingFolder, { recursive: true, force: true });

    res.status(200).send({
      message: 'Execution submitted successfully.',
      id: safeWorkingId, // Stored XSS High
      document: xssFilters.inHTMLData(document),
    });
  },
);

const deleteFile = (file, resultFileName) => {
  //delete file since we read it's contents
  console.log(`deleting file ${resultFileName}`);
  fs.unlinkSync(file);
};

const formatResults = ({ annotations, instrumentationInfo }) => {
  const { numAnnotationsPerType } = instrumentationInfo;
  const annonNames = numAnnotationsPerType.map((n) => n.annotationType);
  let annonResults = {};
  annonNames.forEach((name) => {
    const items = [];
    const annotation = annotations[name];
    annotation.forEach((elem) => {
      const attributes = {};
      Object.keys(elem).forEach((key) => {
        const { location, text } = elem[key];
        attributes[key] = {
          start: location?.begin,
          end: location?.end,
          text: text ?? elem[key],
        };
      });
      items.push({ ...attributes });
    });
    annonResults = { ...annonResults, [name]: items };
  });
  return { annotations: annonResults, names: annonNames };
};

const hasError = (fileContents) => {
  if (fileContents.hasOwnProperty('AqlTaskError')) {
    return fileContents['AqlTaskError'];
  }
  const { instrumentationInfo } = fileContents;
  if (instrumentationInfo.hasOwnProperty('exceptionMessage')) {
    let message = instrumentationInfo['exceptionMessage'];
    message = message.substring(0, message.indexOf(':'));
    return message;
  }
};

app.get(
  '/api/results',
  rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false,
  }),
  function (req, res) {
    const { workingId, exportPipeline } = req.query;
    const safeWorkingId = xssFilters.inHTMLData(workingId);
    const resultFileName =
      exportPipeline === 'true'
        ? `${safeWorkingId}-export.zip`
        : `${safeWorkingId}-result.json`;
    const file = `${systemTdataFolder}/run-aql-result/${resultFileName}`;
    if (!fs.existsSync(file)) {
      //no file present, assume that runtime is still in progress
      console.log(`results file ${resultFileName} not found.`);
      return res.status(202).send({ status: 'in-progress' });
    }
    console.log(
      `SystemT execution time: ${new Date().getTime() - systemTStartTime} ms`,
    );

    //result file was found - read contents of file
    console.log(`results file ${resultFileName} found.`);
    if (exportPipeline === 'true') {
      var stat = fs.statSync(file);
      let fileContents = fs.createReadStream(file);
      const fileType = 'application/zip';
      res.writeHead(200, {
        'Content-Type': fileType,
        'Content-Length': stat.size,
      });
      fileContents.on('close', () => {
        deleteFile(
          `${systemTdataFolder}/run-aql-result/${resultFileName}`,
          resultFileName,
        );
        res.end();
      });
      fileContents.pipe(res);
    } else {
      let fileContents = fs.readFileSync(file, 'utf8');
      const parsedContents = JSON.parse(xssFilters.inHTMLData(fileContents));

      // execution returned errors
      const errorMessage = hasError(parsedContents);
      if (errorMessage) {
        console.log('found error message', errorMessage);
        deleteFile(file, resultFileName);
        return res.status(200).send({ status: 'error', message: errorMessage });
      }

      const results =
        exportPipeline === 'true'
          ? parsedContents
          : formatResults(parsedContents);

      deleteFile(file, resultFileName);
      return res.status(200).send({ status: 'success', ...results });
    }
  },
);

// --------------------- modify root access logic for auth-server
app.get('/', function (req, res) {
  // capture who the logged in user is
  console.log(req.session[WebAppStrategy.AUTH_CONTEXT]);
  if (req.user) {
    user.name = req.user.name;
    user.email = req.user.email;
  }
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(port, () => {
  console.log('Auth-server is running, listening on port:', port);
});
// --------------------- end of change for auth-server
