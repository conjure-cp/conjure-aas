# conjure-aas

Conjure as a service. Mainly for small example/demo jobs.

Hosted at https://conjure-aas.cs.st-andrews.ac.uk

It is running on a small VM at the School of Computer Science, University of St Andrews. Do not expect the best performance...

## Conjure Client

This API provides a front-end JS client to allow developers to submit jobs through a simple interface.

Below is a simple example of how to use the client:

```html
<script src="https://conjure-aas.cs.st-andrews.ac.uk/client.js"></script>
<script>
    const client = new ConjureClient("example-app");

    client.solve("find x: int(1..3) such that x > 2")
        .then(result => console.log(result.solution));
</script>
```

### Options

The `solve` method accepts an optional object containing additional parameters:

- The solver used by Conjure can be changed with the **solver** parameter and defaults to "kissat".
You can find a full list of available solvers in the [documentation](https://conjure.readthedocs.io/en/latest/features.html#multiple-target-solvers).

- Additional data, like variable assignments, can be given via the **data** parameter.

- The **options** parameter allows you to pass additional command line options to Conjure. For example, to specify the number of solutions returned, you can use the `--number-of-solutions` option.

```js
client.solve("given m: int, find x: int(1..3) such that x > m", {
    data: { "m": 2 },
    solver: "minion",
    options: ["--number-of-solutions", "1"],
}).then(result => console.log(result.solution));
```

## Named Python Solvers

In addition to Essence models, the service can run named Python solvers from the `custom` directory. A request with `modelName: "rostering"` runs:

```bash
python3 custom/rostering.py conjure-output/<jobid>/input.json --output conjure-output/<jobid>/solution.json
```

The solver should write logs to stdout/stderr and write its JSON solution to the path supplied after `--output`. The existing `/get` endpoint returns that JSON as `solution`, alongside the captured logs.

Additional command-line arguments can be passed with `solverOptions`:

```bash
python3 custom/rostering.py conjure-output/<jobid>/input.json --output conjure-output/<jobid>/solution.json --time-limit 60
```

The named solver API accepts JSON input as either `input` or `data`:

```js
fetch("/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        appName: "example-app",
        modelName: "rostering",
        input: { users: [], shifts: [] },
        solverOptions: ["--time-limit", "60"],
    }),
});
```

The JavaScript client exposes the same path with `solveNamed`:

```js
const client = new ConjureClient("example-app");

client.solveNamed("rostering", { users: [], shifts: [] }, {
    options: ["--time-limit", "60"],
})
    .then(result => console.log(result.solution));
```
