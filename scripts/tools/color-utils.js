export function inkOn(color)
{
    const hex = String(color ?? '');
    const red = Number.parseInt(hex.slice(1, 3), 16) || 0;
    const green = Number.parseInt(hex.slice(3, 5), 16) || 0;
    const blue = Number.parseInt(hex.slice(5, 7), 16) || 0;
    return (red * 0.299 + green * 0.587 + blue * 0.114) > 150 ? '#111' : '#fff';
}
