
const fs = require("fs");
const { spawn } = require("node:child_process");
const md5 = require("md5");
const { v4: uuidv4 } = require("uuid");

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
    let thisJobId = uuidv4();

    let appName = "unknown-app";
    if (req.body.appName !== undefined) {
        appName = req.body.appName;
    }

    log(`submit ${appName} ${thisJobId}`)

    // create directory
    fs.mkdirSync(`conjure-output/${thisJobId}`, { recursive: true });

    if (req.body.metadata !== undefined && req.body.metadata !== "") {
        fs.writeFileSync(`conjure-output/${thisJobId}/metadata.json`, req.body.metadata);
    }

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

    // --------------------------------------------------------------------------------
    // command for running without podman - just for logging
    let conjureArgs = ["solve"
        , `conjure-output/${thisJobId}/model.essence`
        , `conjure-output/${thisJobId}/data.json`
        , "--output-directory", `conjure-output/${thisJobId}`
        , "--solver", solver
        , "--output-format=json"
        , "--solutions-in-one-file"
        , "--copy-solutions=no"
    ].concat(conjureOptions)
    // run conjure
    // let conjureSpawn = spawn("conjure", conjureArgs, { shell: true });

    // --------------------------------------------------------------------------------
    // command for running with podman
    let podmanArgs = ["run"
        , "--rm"
        , "--network=none"
        , `-v $PWD/conjure-output/${thisJobId}:/outdir:z`
        , "ghcr.io/conjure-cp/conjure@sha256:c0ae2d6a9681e63604d4327730b2882c58b30b2e5e5d14770697e8a738c0b745"
        , "conjure"
        , "solve"
        , "/outdir/model.essence"
        , "/outdir/data.json"
        , "--output-directory", "/outdir"
        , "--solver", solver
        , "--output-format=json"
        , "--solutions-in-one-file"
        , "--copy-solutions=no"
    ].concat(conjureOptions)

    // run conjure
    let conjureSpawn = spawn("podman", podmanArgs, { shell: true });

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
    log(`submit ${appName} ${thisJobId} - command: conjure ${conjureArgs.join(' ')}`)
    log(`submit ${appName} ${thisJobId} - command: podman ${podmanArgs.join(' ')}`)
    fs.writeFileSync(`conjure-output/${thisJobId}/status.txt`, `wait`);
    res.json({ jobid: thisJobId });
}

function getHandler(req, res) {
    let jobid = req.body.jobid;

    let appName = "unknown-app";
    if (req.body.appName !== undefined) {
        appName = req.body.appName;
    }

    let timeDifferenceInSecs = 0;

    // reading the status file
    const statusFile = `conjure-output/${jobid}/status.txt`;
    let status_ = "";
    try {
        status_ = fs.readFileSync(statusFile, "utf8");
        let stats = fs.statSync(statusFile);
        timeDifferenceInSecs = Math.abs(stats.mtime.getTime() - Date.now()) / 1000;
    } catch (err) {
        status_ = "not found";
    }

    if (status_ == "not found" || timeDifferenceInSecs > 600) {

        // doesn't exist or has expired.
        // we serve the same response in either case
        log(`get wontserve ${appName} ${jobid} - ${status_} - ${timeDifferenceInSecs}`);
        res.json({ status: "unknown" });

    } else {

        // we can serve the response

        // reading the logs
        const logsFile = `conjure-output/${jobid}/logs.txt`;
        let logs = "";
        try {
            logs = fs.readFileSync(logsFile, "utf8");
            logs = logs.split(/\r?\n/);
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
}

app.use("/", express.static("index.html"))
app.post("/submit", submitHandler);
app.post("/get", getHandler);

app.listen(8080, () => console.log("listening"));
