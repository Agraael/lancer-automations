export function watchDamageHud(sync)
{
    let pending = false;
    let formSeen = false;

    const run = () =>
    {
        pending = false;
        const form = document.querySelector('#damage-hud');
        if (form)
            sync($(form), schedule);
    };

    function schedule()
    {
        if (pending)
            return;
        pending = true;
        setTimeout(run, 50);
    }

    const onEdit = (event) =>
    {
        if (event.target instanceof Element && event.target.closest('#damage-hud'))
            schedule();
    };

    const observer = new MutationObserver(() =>
    {
        if (!document.querySelector('#damage-hud'))
        {
            if (formSeen)
                stop();
            return;
        }

        formSeen = true;
        schedule();
    });

    function stop()
    {
        observer.disconnect();
        document.removeEventListener('change', onEdit, true);
        document.removeEventListener('input', onEdit, true);
    }

    observer.observe(document.querySelector('#hudzone') ?? document.body, { childList: true, subtree: true });
    document.addEventListener('change', onEdit, true);
    document.addEventListener('input', onEdit, true);
    setTimeout(stop, 600000);
    schedule();
}
