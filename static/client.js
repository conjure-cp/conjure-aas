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
     * @param {string} model The Essence model to solve.
     * @param {Object} params An object containing optional parameters.
     * @param {string | Object} params.data An object to pass as data to the solver.
     * @param {string} params.solver For a list of solvers see the {@link https://conjure.readthedocs.io/en/latest/features.html#multiple-target-solvers documentation}.
     * @param {[string]} params.options An array of command-line options to pass to Conjure.
     * @returns A `Promise` that resolves to a solution object.
     */
    solve(model, params={}) {
        const solver = params.solver || "kissat";
        const options = params.options || [];
        const data = params.data || {};
        const data_str = typeof data === "string" ? data : JSON.stringify(data);
        return this._submit(model, data_str, solver, options)
            .then(jobid => this._get(jobid));
    }

    _submit(model, data_str, solver, options) {
        return new Promise((resolve, reject) => {
            fetch(`${this.domain}/submit`, {
                method: 'POST', headers: {
                    'Content-Type': 'application/json'
                }, body: JSON.stringify({
                    appName: this.appName,
                    solver,
                    model,
                    data: data_str,
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
                            setTimeout(poll, 2000); // Poll every second
                        } else {
                            resolve(res);
                        }
                    })
                    .catch(err => reject(err));
            }
            setTimeout(poll, 2000);
        });
    }
}
