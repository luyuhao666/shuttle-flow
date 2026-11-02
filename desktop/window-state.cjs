'use strict';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A saved window must remain reachable after unplugging a monitor or changing DPI.
function fitWindowState(saved, workAreas) {
  const primary = workAreas[0];
  const previous = saved?.bounds;
  const valid = previous && ['x', 'y', 'width', 'height'].every(key => finite(previous[key])) && previous.width > 0 && previous.height > 0;
  const area = valid ? workAreas.find(item => {
    const x = previous.x + previous.width / 2, y = previous.y + previous.height / 2;
    return x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height;
  }) ?? primary : primary;
  const minWidth = Math.min(760, area.width), minHeight = Math.min(560, area.height);
  const width = Math.round(clamp(valid ? previous.width : 1400, minWidth, Math.max(minWidth, area.width - 48)));
  const height = Math.round(clamp(valid ? previous.height : 900, minHeight, Math.max(minHeight, area.height - 48)));
  const x = Math.round(clamp(valid ? previous.x : area.x + (area.width - width) / 2, area.x, area.x + area.width - width));
  const y = Math.round(clamp(valid ? previous.y : area.y + (area.height - height) / 2, area.y, area.y + area.height - height));
  return { bounds: { x, y, width, height }, minWidth, minHeight, maximized: saved?.maximized === true };
}

module.exports = { fitWindowState };
