const round = (value: number) => Math.round(value * 100) / 100;

export function buildSparklinePoints(values: number[], width = 320, height = 96) {
  if (values.length === 0) return "";
  if (values.length === 1) return `${round(width / 2)},${round(height / 2)}`;

  const safe = values.map((value) => Number.isFinite(value) ? value : 0);
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;

  return safe.map((value, index) => {
    const x = (index / (safe.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${round(x)},${round(y)}`;
  }).join(" ");
}

export function buildDonutSegments(items: Array<{ key: string; value: number }>) {
  const normalized = items.map((item) => ({
    key: item.key,
    value: Math.max(0, Number(item.value) || 0),
  }));
  const total = normalized.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;

  return normalized.map((item) => {
    const percent = total > 0 ? round((item.value / total) * 100) : 0;
    const segment = { ...item, percent, offset: round(offset) };
    offset += percent;
    return segment;
  });
}
