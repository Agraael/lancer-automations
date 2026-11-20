const PIE_SIZE = 68;

function polarPoint(center, radius, degrees)
{
    const radians = (degrees - 90) * Math.PI / 180;
    return `${(center + radius * Math.cos(radians)).toFixed(2)} ${(center + radius * Math.sin(radians)).toFixed(2)}`;
}

export function pieHtml(max)
{
    const center = PIE_SIZE / 2;
    const radius = center - 1.5;
    const step = 360 / max;
    let wedges = '';

    for (let segment = 1; segment <= max; segment++)
    {
        const start = (segment - 1) * step;
        const largeArc = step > 180 ? 1 : 0;
        wedges += `<path class="lawc-seg" data-segment="${segment}" d="M${center} ${center}L${polarPoint(center, radius, start)}A${radius} ${radius} 0 ${largeArc} 1 ${polarPoint(center, radius, start + step)}Z"></path>`;
    }

    return `<svg class="lawc-pie" width="${PIE_SIZE}" height="${PIE_SIZE}" viewBox="0 0 ${PIE_SIZE} ${PIE_SIZE}">${wedges}<circle class="lawc-pie-edge" cx="${center}" cy="${center}" r="${radius}"></circle></svg>`;
}

export function ringHtml(max, size, withNumber = true)
{
    const center = size / 2;
    const strokeWidth = Math.max(3, size * 0.17);
    const radius = center - strokeWidth / 2 - 0.5;
    const step = 360 / max;
    const gap = Math.min(10, step * 0.22);
    let arcs = '';

    for (let segment = 1; segment <= max; segment++)
    {
        const start = (segment - 1) * step + gap / 2;
        const end = start + step - gap;
        const largeArc = end - start > 180 ? 1 : 0;
        arcs += `<path class="lawc-seg lawc-seg--arc" data-segment="${segment}" style="stroke-width:${strokeWidth};" d="M${polarPoint(center, radius, start)}A${radius} ${radius} 0 ${largeArc} 1 ${polarPoint(center, radius, end)}"></path>`;
    }

    const number = withNumber ? `<text class="lawc-ring-number" x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central" style="font-size:${Math.round(size * 0.4)}px;"></text>` : '';
    return `<svg class="lawc-pie" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}${number}</svg>`;
}

export function paintSegments(root, value)
{
    for (const segment of root.querySelectorAll('.lawc-seg'))
        segment.classList.toggle('lawc-seg--on', Number(segment.dataset.segment) <= value);

    const number = root.querySelector('.lawc-ring-number');
    if (number)
        number.textContent = String(value);
}
