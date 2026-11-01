let _chain = Promise.resolve();
let _pending = 0;

export function queueFirstRun(task)
{
    _pending++;
    const run = _chain.then(task).finally(() =>
    {
        _pending--;
    });
    _chain = run.catch(() => undefined);
    return run;
}

export async function afterFirstRun()
{
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    while (_pending > 0)
        await _chain;
}
