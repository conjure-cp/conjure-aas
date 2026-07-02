# conjure-aas

Conjure as a service. Mainly for small example/demo jobs.

Hosted at https://conjure-aas.cs.st-andrews.ac.uk

It is running on a small VM at the School of Computer Science, University of St Andrews. Do not expect the best performance...

To run your own instance, install the Node.js dependencies before running the service: `npm install` and run `node conjure-aas.js`

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

## Custom Python solvers

Named solvers live as `custom/<name>.py`. Submit with `modelName` (not Conjure `model`):

```js
client.solveNamed("my-solver", {})
```

The service runs:

```bash
python3 custom/<name>.py <jobdir>/input.json --output <jobdir>/solution.json [solverOptions...]
```

### Per-solver virtualenv (optional)

Each named solver may have its own dependencies under `custom/<name>/venv/`. If that venv exists, conjure-aas uses its Python instead of system `python3`:

```bash
mkdir -p custom/my-solver
cp my_solver.py custom/my-solver.py
python3 -m venv custom/my-solver/venv
custom/my-solver/venv/bin/pip install -r requirements.txt
```

Optional `custom/<name>/requirements.txt` is not installed automatically; create and populate the venv before submitting jobs.
