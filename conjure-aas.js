
const fs = require('fs');
const { spawn } = require('node:child_process');
const md5 = require('md5');

let config = fs.readFileSync("config.json");
config = JSON.parse(config);

const express = require('express');

const app = express();

app.use(express.json())
app.use(express.static('static'))

fs.mkdirSync('model-cache', { recursive: true });
fs.mkdirSync('conjure-output', { recursive: true });
let logStream = fs.createWriteStream('logs.txt', { flags: 'a' });

function log(message) {
    let timestamp = new Date().toISOString();
    logStream.write(`${timestamp} ${message}\n`);
    console.log(`${timestamp} ${message}`);
}

function submitHandler(req, res) {

    // next job id
    let thisJobId = config.nextJobId++;
    fs.writeFileSync('config.json', JSON.stringify(config));

    log(`submit ${thisJobId}`)

    // create directory
    fs.mkdirSync(`conjure-output/${thisJobId}`);

    // we cache the essence + eprime in a model-cache to avoid rerunning conjure-modelling
    let cacheKey = md5(req.body.model);
    let cacheHit = false;

    // create Conjure's input files
    try {
        // can we copy from the cache?
        fs.copyFileSync(`model-cache/${cacheKey}.conjure-checksum`, `conjure-output/${thisJobId}/.conjure-checksum`);
        fs.copyFileSync(`model-cache/${cacheKey}.essence`, `conjure-output/${thisJobId}/model.essence`);
        fs.copyFileSync(`model-cache/${cacheKey}.eprime`, `conjure-output/${thisJobId}/model000001.eprime`);
        log(`submit ${thisJobId} - cache hit`);
        cacheHit = true;
    } catch (e) {
        log(`submit ${thisJobId} - cache miss`);
        fs.writeFileSync(`conjure-output/${thisJobId}/model.essence`, req.body.model);
        cacheHit = false;
    }

    // the data file
    fs.writeFileSync(`conjure-output/${thisJobId}/data.json`, req.body.data);

    // the user can specify which solver to use, default is kissat
    let solver = "kissat";
    if (req.body.solver !== undefined) {
        solver = req.body.solver;
    }

    // run conjure
    let conjure_spawn = spawn('conjure',
        ['solve'
            , `conjure-output/${thisJobId}/model.essence`
            , `conjure-output/${thisJobId}/data.json`
            , '--output-directory', `conjure-output/${thisJobId}`
            , '--solver', solver
            , '--output-format=json'
            , '--copy-solutions=no'
        ]);

    let thisLogStream = fs.createWriteStream(`conjure-output/${thisJobId}/logs.txt`, { flags: 'a' });
    conjure_spawn.stdout.pipe(thisLogStream);
    conjure_spawn.stderr.pipe(thisLogStream);
    conjure_spawn.on('close', (code) => {
        if (code == 0 && cacheHit == false) {
            // save the model in the model-cache
            fs.copyFileSync(`conjure-output/${thisJobId}/.conjure-checksum`, `model-cache/${cacheKey}.conjure-checksum`);
            fs.copyFileSync(`conjure-output/${thisJobId}/model.essence`, `model-cache/${cacheKey}.essence`);
            fs.copyFileSync(`conjure-output/${thisJobId}/model000001.eprime`, `model-cache/${cacheKey}.eprime`);
            log(`submit ${thisJobId} - cache populated ${cacheKey}`);
        }
        log(`submit ${thisJobId} - exitcode ${code}`);
        thisLogStream.write(`submit ${thisJobId} - exitcode ${code}\n`);
    });

    log(`submit ${thisJobId} - spawned`)
    res.json({ jobid: thisJobId });
}

function getHandler(req, res) {
    let jobid = req.body.jobid;
    const solutionFile = `conjure-output/${jobid}/model000001-data-solution000001.solution.json`
    if (fs.existsSync(solutionFile)) {
        log(`get ${jobid} - ok`);
        res.json({ status: "ok", solution: JSON.parse(fs.readFileSync(solutionFile)) });
    }
    else {
        log(`get ${jobid} - wait`);
        res.json({ status: "wait" });
    }
}

app.post('/submit', submitHandler);
app.post('/get', getHandler);

app.listen(8080, () => console.log('listening'));
