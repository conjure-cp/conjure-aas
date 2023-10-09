
const fs = require("fs");
const { spawn } = require("node:child_process");
const md5 = require("md5");

const express = require("express");
const cors = require('cors')

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("static"));

fs.mkdirSync("model-cache", { recursive: true });
fs.mkdirSync("conjure-output", { recursive: true });
let logStream = fs.createWriteStream("logs.txt", { flags: "a" });


function log(message) {
    let timestamp = new Date().toISOString();
    logStream.write(`${timestamp} ${message}\n`);
    console.log(`${timestamp} ${message}`);
}

function submitHandler(req, res) {

    // next job id
    // we are not locking this file, so there might be a clash here...
    let config = fs.readFileSync("config.json");
    config = JSON.parse(config);
    let thisJobId = config.nextJobId++;
    fs.writeFileSync("config.json", JSON.stringify(config));

    let appName = "unknown-app";
    if (req.body.appName !== undefined) {
        appName = req.body.appName;
    }

    log(`submit ${appName} ${thisJobId}`)

    // create directory
    fs.mkdirSync(`conjure-output/${thisJobId}`, { recursive: true });

    // we cache the essence + eprime in a model-cache to avoid rerunning conjure-modelling
    let cacheKey = md5(req.body.model.trim());
    let cacheHit = false;

    // create Conjure's input files
    try {
        // can we copy from the cache?
        fs.copyFileSync(`model-cache/${cacheKey}.conjure-checksum`, `conjure-output/${thisJobId}/.conjure-checksum`);
        fs.copyFileSync(`model-cache/${cacheKey}.essence`, `conjure-output/${thisJobId}/model.essence`);
        fs.copyFileSync(`model-cache/${cacheKey}.eprime`, `conjure-output/${thisJobId}/model000001.eprime`);
        log(`submit ${appName} ${thisJobId} - cache hit ${cacheKey}`);
        cacheHit = true;
    } catch (e) {
        log(`submit ${appName} ${thisJobId} - cache miss ${cacheKey}`);
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

    // the user can specify additional options to be passed to conjure
    let conjureOptions = [];

    if (req.body.conjureOptions !== undefined) {
        conjureOptions = req.body.conjureOptions;
    } else if (req.body.conjure_options !== undefined) { // so we don't break existing code
        conjureOptions = req.body.conjure_options;
    }

    let conjureArgs = ["solve"
        , `conjure-output/${thisJobId}/model.essence`
        , `conjure-output/${thisJobId}/data.json`
        , "--output-directory", `conjure-output/${thisJobId}`
        , "--solver", solver
        , "--output-format=json"
        , "--solutions-in-one-file"
        , "--copy-solutions=no"
    ].concat(conjureOptions)
    log(`command: conjure ${conjureArgs.join(' ')}`)
    // run conjure
    let conjureSpawn = spawn("conjure", conjureArgs, { shell: true });

    let thisLogStream = fs.createWriteStream(`conjure-output/${thisJobId}/logs.txt`, { flags: "a" });
    conjureSpawn.stdout.pipe(thisLogStream);
    conjureSpawn.stderr.pipe(thisLogStream);
    conjureSpawn.on("close", (code) => {
        if (code == 0 && cacheHit == false) {
            // save the model in the model-cache
            fs.copyFileSync(`conjure-output/${thisJobId}/.conjure-checksum`, `model-cache/${cacheKey}.conjure-checksum`);
            fs.copyFileSync(`conjure-output/${thisJobId}/model.essence`, `model-cache/${cacheKey}.essence`);
            fs.copyFileSync(`conjure-output/${thisJobId}/model000001.eprime`, `model-cache/${cacheKey}.eprime`);
            log(`submit ${appName} ${thisJobId} - cache populated ${cacheKey}`);
        }
        log(`submit ${appName} ${thisJobId} - exitcode ${code}`);
        thisLogStream.write(`submit ${thisJobId} - exitcode ${code}\n`);
        fs.writeFileSync(`conjure-output/${thisJobId}/status.txt`, `terminated - exitcode ${code}`);
    });

    log(`submit ${appName} ${thisJobId} - spawned with options: ${conjureOptions}`)
    fs.writeFileSync(`conjure-output/${thisJobId}/status.txt`, `wait`);
    res.json({ jobid: thisJobId });
}

function getHandler(req, res) {
    let jobid = req.body.jobid;

    let appName = "unknown-app";
    if (req.body.appName !== undefined) {
        appName = req.body.appName;
    }

    // reading the logs
    const logsFile = `conjure-output/${jobid}/logs.txt`;
    let logs = "";
    try {
        logs = fs.readFileSync(logsFile, "utf8");
        logs = logs.split("\n");
    } catch (err) {
        logs = err;
    }

    // reading the info file
    const infoFile = `conjure-output/${jobid}/model000001-data.eprime-info`;
    let info = "";
    try {
        info = fs.readFileSync(infoFile, "utf8");
        let infoObj = {}
        for (let line of info.split("\n")) {
            let parts = line.split(":");
            if (parts.length == 2) {
                infoObj[parts[0]] = parts[1]
            }
        }
        info = infoObj;
    } catch (err) {
        info = err;
    }

    // reading the status file
    const statusFile = `conjure-output/${jobid}/status.txt`;
    let status_ = "";
    try {
        status_ = fs.readFileSync(statusFile, "utf8");
    } catch (err) {
        status_ = "not found";
    }

    // reading the solution flie
    const solutionFile = `conjure-output/${jobid}/model000001-data.solutions.json`;
    try {
        const solution = JSON.parse(fs.readFileSync(solutionFile));
        log(`get ${appName} ${jobid} - ok`);
        res.json({
            status: "ok"
            , solution: solution
            , info: info
            , logs: logs
        });
    } catch (err) {
        log(`get ${appName} ${jobid} - ${status_}`);
        res.json({
            status: status_
            , info: info
            , logs: logs
            , err: err
        });
    }
}

app.use("/", express.static("index.html"))
app.post("/submit", submitHandler);
app.post("/get", getHandler);

app.listen(8080, () => console.log("listening"));
