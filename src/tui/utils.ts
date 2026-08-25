export interface FixedWindowResult<T> {
  windowItems: T[];
  startIndex: number;
  padCount: number;
}

export function getFixedWindow<T>(
  items: T[],
  selectedIndex: number,
  windowSize: number
): FixedWindowResult<T> {
  if (items.length === 0) {
    return { windowItems: [], startIndex: 0, padCount: windowSize };
  }

  const actualSize = Math.min(items.length, windowSize);
  let startIndex = selectedIndex - Math.floor(windowSize / 2);

  if (startIndex + actualSize > items.length) {
    startIndex = items.length - actualSize;
  }
  if (startIndex < 0) {
    startIndex = 0;
  }

  const windowItems = items.slice(startIndex, startIndex + actualSize);
  const padCount = windowSize - windowItems.length;

  return { windowItems, startIndex, padCount };
}
