export function nowISO() {
  return new Date().toISOString();
}

export function oneWeekAgoISO() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}
