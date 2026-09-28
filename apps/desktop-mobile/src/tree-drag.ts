export function treeMoveDestination(source: string, folder: string, paths: readonly string[]): string | null {
  if (!source || !paths.includes(source) || (folder && !paths.includes(folder))) return null;
  if (folder === source || folder.startsWith(`${source}/`)) return null;
  const name = source.split('/').pop();
  if (!name) return null;
  const destination = folder ? `${folder}/${name}` : name;
  if (destination === source || paths.includes(destination)) return null;
  return destination;
}
