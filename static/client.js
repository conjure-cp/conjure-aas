const _DEFAULT_DOMAIN = "https://conjure-aas.cs.st-andrews.ac.uk"
const _LUBY_GEN = luby();
const _LUBY_MULT = 1000; // Multiplier for the number of milliseconds to wait between polls

/**
 * A client for the Conjure AAS API.
 * 
 * Provides an abstract interface to solve Essence problems.
 */
class ConjureClient {
    /**
     * Creates a new client for the Conjure AAS service.
     * @param {string} appName An identifying name for your application.
     * @param {string} domain An optional domain to use. Defaults to the public Conjure AAS API.
     */
    constructor(appName, domain = _DEFAULT_DOMAIN) {
        this.appName = appName;
        this.domain = domain;
    }

    /**
     * Submits the given Essence string to the service and returns the solution.
     * @param {string} model 
     * @param {*} data Optional data to be included, e.g. variable assignments.
     * @param {string} solver For a list of solvers see the {@link https://conjure.readthedocs.io/en/latest/features.html#multiple-target-solvers documentation}.
     * @param {[string]} options An ordered list of command-line options to pass to Conjure, e.g. ["--number-of-solutions", "1"]
     * @returns A `Promise` that resolves to a solution object.
     */
    solve(model, data = {}, solver = "kissat", options = []) {
        return this._submit(model, data, solver, options)
            .then(jobid => this._get(jobid));
    }

    _submit(model, data = {}, solver = "kissat", options = []) {
        return new Promise((resolve, reject) => {
            fetch(`${this.domain}/submit`, {
                method: 'POST', headers: {
                    'Content-Type': 'application/json'
                }, body: JSON.stringify({
                    appName: this.appName,
                    solver,
                    model,
                    data,
                    conjureOptions: options,
                })
            })
                .then(response => response.json())
                .then(json => resolve(json.jobid))
                .catch(err => reject(err))
        });
    }

    _poll(jobid) {
        return new Promise((resolve, reject) => {
            fetch(`${this.domain}/get`, {
                method: 'POST', headers: {
                    'Content-Type': 'application/json'
                }, body: JSON.stringify({
                    appName: this.appName,
                    jobid,
                })
            })
                .then(response => response.json())
                .then(json => resolve(json))
                .catch(err => reject(err))
        });
    }

    _get(jobid) {
        return new Promise((resolve, reject) => {
            let poll = () => {
                this._poll(jobid)
                    .then(res => {
                        if (res.status == "wait") {
                            setTimeout(poll, _LUBY_GEN.next().value * _LUBY_MULT);
                        } else {
                            resolve(res);
                        }
                    })
                    .catch(err => reject(err));
            }
            setTimeout(poll, _LUBY_GEN.next().value * _LUBY_MULT);
        });
    }
}

/**
 * A generator for a Luby sequence with a growth rate of 2.
 */
function* luby() {
    let seq = [1];
    for (let i = 1;; i++) {
        seq[i] = _luby(i, seq);
        yield seq[i];
    }
}

function _luby(i, seq) {
    for (let k = 1;; k++) {
        if (i == 2 ** k - 1)
            return 2 **  (k - 1);
        if ((2 ** (k - 1)) <= i && i < 2 ** k - 1)
            return seq[i - 2 ** (k - 1) + 1];
    }
}
