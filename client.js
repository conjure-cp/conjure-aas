const _DEFAULT_DOMAIN = "https://conjure-aas.cs.st-andrews.ac.uk"

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
     * @param {string} essence 
     * @param {*} data Optional data to be included, e.g. variable assignments.
     * @param {"kissat"|"minion"|TODO} solver The solver to use.
     * @param {[string]} options Additional options to pass to Conjure.
     * @returns A `Promise` that resolves to a solution object.
     */
    solve(essence, data = {}, solver = "kissat", options = []) {
        return this._submit(essence, data, solver, options)
            .then(jobid => this._get(jobid));
    }

    _submit(essence, data = {}, solver = "kissat", options = []) {
        return new Promise((resolve, reject) => {
            fetch(`${this.domain}/submit`, {
                method: 'POST', headers: {
                    'Content-Type': 'application/json'
                }, body: JSON.stringify({
                    appName: this.appName,
                    solver: solver,
                    model: essence,
                    data: data,
                    conjureOptions: options
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
                    jobid: jobid
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
                            setTimeout(poll, 1000); // Poll every second
                        } else {
                            resolve(res);
                        }
                    })
                    .catch(err => reject(err));
            }
            setTimeout(poll, 1000); // TODO: Minimum solving time
        });
    }
}
