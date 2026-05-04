
const fs = require("fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
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
fs.mkdirSync("custom", { recursive: true });
let logStream = fs.createWriteStream("logs.txt", { flags: "a" });


function log(message) {
    let timestamp = new Date().toISOString();
    logStream.write(`${timestamp} ${message}\n`);
    console.log(`${timestamp} ${message}`);
}

function getNamedModel(reqBody) {
    return reqBody.modelName || reqBody.namedModel || reqBody.customModel || "";
}

function validateNamedModel(modelName) {
    if (typeof modelName !== "string" || !/^[A-Za-z0-9_-]+$/.test(modelName)) {
        throw new Error("named model must contain only letters, numbers, underscores, and hyphens");
    }

    return path.join("custom", `${modelName}.py`);
}

function writeJsonInput(inputFile, data) {
    if (typeof data === "string") {
        fs.writeFileSync(inputFile, data);
    } else {
        fs.writeFileSync(inputFile, JSON.stringify(data ?? {}, undefined, 2));
    }
}

function getNamedModelInput(reqBody) {
    if (reqBody.input !== undefined) {
        return reqBody.input;
    }
    if (reqBody.data !== undefined) {
        return reqBody.data;
    }
    return reqBody;
}

function getNamedModelOptions(reqBody) {
    if (reqBody.solverOptions !== undefined) {
        return reqBody.solverOptions;
    }
    if (reqBody.solver_options !== undefined) {
        return reqBody.solver_options;
    }
    if (reqBody.namedOptions !== undefined) {
        return reqBody.namedOptions;
    }
    if (reqBody.customOptions !== undefined) {
        return reqBody.customOptions;
    }
    if (reqBody.options !== undefined) {
        return reqBody.options;
    }
    return [];
}

function submitHandler(req, res) {

    // next job id
    let thisJobId = randomUUID();

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

    let namedModel = getNamedModel(req.body);
    if (namedModel !== "") {
        return submitNamedModel(req, res, thisJobId, appName, namedModel);
    }

    if (req.body.model === undefined) {
        fs.writeFileSync(`conjure-output/${thisJobId}/status.txt`, "terminated - missing model");
        res.status(400).json({ error: "missing model or modelName" });
        return;
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

function submitNamedModel(req, res, thisJobId, appName, namedModel) {
    let modelPath = "";
    try {
        modelPath = validateNamedModel(namedModel);
    } catch (err) {
        fs.writeFileSync(`conjure-output/${thisJobId}/status.txt`, `terminated - ${err.message}`);
        res.status(400).json({ error: err.message });
        return;
    }

    if (!fs.existsSync(modelPath)) {
        fs.writeFileSync(`conjure-output/${thisJobId}/status.txt`, `terminated - named model not found: ${namedModel}`);
        res.status(404).json({ error: `named model not found: ${namedModel}` });
        return;
    }

    const jobDir = `conjure-output/${thisJobId}`;
    const inputFile = `${jobDir}/input.json`;
    const solutionFile = `${jobDir}/solution.json`;
    const solverOptions = getNamedModelOptions(req.body);

    if (!Array.isArray(solverOptions)) {
        fs.writeFileSync(`${jobDir}/status.txt`, "terminated - solver options must be an array");
        res.status(400).json({ error: "solver options must be an array" });
        return;
    }

    writeJsonInput(inputFile, getNamedModelInput(req.body));
    fs.writeFileSync(`${jobDir}/named-model.txt`, namedModel);

    const solverArgs = [modelPath, inputFile, "--output", solutionFile].concat(solverOptions);
    const solverSpawn = spawn("python3", solverArgs);

    let thisLogStream = fs.createWriteStream(`${jobDir}/logs.txt`, { flags: "a" });
    solverSpawn.stdout.pipe(thisLogStream);
    solverSpawn.stderr.pipe(thisLogStream);
    solverSpawn.on("error", (err) => {
        log(`submit ${appName} ${thisJobId} - named model ${namedModel} failed to start: ${err.message}`);
        thisLogStream.write(`submit ${thisJobId} - named model ${namedModel} failed to start: ${err.message}\n`);
        fs.writeFileSync(`${jobDir}/status.txt`, `terminated - ${err.message}`);
    });
    solverSpawn.on("close", (code) => {
        log(`submit ${appName} ${thisJobId} - named model ${namedModel} exitcode ${code}`);
        thisLogStream.write(`submit ${thisJobId} - named model ${namedModel} exitcode ${code}\n`);
        fs.writeFileSync(`${jobDir}/status.txt`, `terminated - exitcode ${code}`);
    });

    log(`submit ${appName} ${thisJobId} - named model ${namedModel}`);
    log(`submit ${appName} ${thisJobId} - spawned with options: ${solverOptions}`);
    log(`submit ${appName} ${thisJobId} - command: python3 ${solverArgs.join(' ')}`);
    fs.writeFileSync(`${jobDir}/status.txt`, `wait`);
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

        const namedJob = fs.existsSync(`conjure-output/${jobid}/named-model.txt`);
        const namedSolutionFile = `conjure-output/${jobid}/solution.json`;
        const solutionFile = namedJob || fs.existsSync(namedSolutionFile)
            ? namedSolutionFile
            : `conjure-output/${jobid}/model000001-data.solutions.json`;

        // reading the info file
        const infoFile = `conjure-output/${jobid}/model000001-data.eprime-info`;
        let info = "";
        if (namedJob) {
            info = {};
        } else {
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
        }

        // reading the solution file
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

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`listening on ${port}`));
