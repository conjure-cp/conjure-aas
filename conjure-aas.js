
const fs = require('fs');
const { spawn } = require('node:child_process');

let config = fs.readFileSync("config.json");
config = JSON.parse(config);

const express = require('express');

const app = express();

app.use(express.json())
app.use(express.static('static'))


function submitHandler(req, res) {
    let thisJobId = config.nextJobId++;
    fs.writeFileSync("config.json", JSON.stringify(config));

    console.log(`received ${thisJobId}`)
    // console.log(req.body);

    // create directory
    fs.mkdirSync(`conjure-output/${thisJobId}`, { recursive: true });

    // create Conjure's input files
    fs.writeFileSync(`conjure-output/${thisJobId}/model.essence`, req.body.model);
    fs.writeFileSync(`conjure-output/${thisJobId}/data.json`, req.body.data);

    // run conjure

    conjure_spawn = spawn('conjure',
        ['solve'
            , `conjure-output/${thisJobId}/model.essence`
            , `conjure-output/${thisJobId}/data.json`
            , '--output-directory', `conjure-output/${thisJobId}`
            , '--solver', 'kissat'
            , '--output-format', 'json'
            // , '--copy-solutions', 'no'
        ]);

    conjure_spawn.stdout.on('data', (data) => {
        console.log(`stdout (${thisJobId}): ${data}`);
    });

    conjure_spawn.stderr.on('data', (data) => {
        console.error(`stderr (${thisJobId}): ${data}`);
    });

    conjure_spawn.on('close', (code) => {
        if (code != 0) {
            console.log(`child process (${thisJobId}) exited with code ${code}`);
        }
    });

    console.log(`spawned ${thisJobId}`)
    res.json({ jobid: thisJobId });
}

function getHandler(req, res) {
    let jobid = req.body.jobid;
    console.log(`get ${jobid}`);
    const solutionFile = `conjure-output/${jobid}/model000001-data-solution000001.solution.json`
    if (fs.existsSync(solutionFile)) {
        console.log(`get ${jobid}: ok`);
        res.json({ status: "ok", solution: JSON.parse(fs.readFileSync(solutionFile)) });
    }
    else {
        console.log(`get ${jobid}: wait`);
        res.json({ status: "wait" });
    }
}

app.post('/submit', submitHandler);
app.post('/get', getHandler);

app.listen(8080, () => console.log('listening'));

// fs.writeFileSync("config.json", JSON.stringify(config));
