export function platformLabels(platform: string) {
  const windows = /win/i.test(platform);
  const mac = /mac/i.test(platform);
  return {
    modifier: mac ? '⌘' : 'Ctrl',
    credentials: windows ? 'Windows 凭据管理器' : mac ? 'macOS Keychain' : '系统凭据存储',
    desktop: windows ? 'Windows' : mac ? 'macOS' : '桌面',
    openDirectory: mac ? '在访达中打开目录' : windows ? '在资源管理器中打开目录' : '在文件管理器中打开目录',
  };
}
export const platform = platformLabels(typeof navigator === 'undefined' ? '' : navigator.platform);
export function lineSeparator(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') && !content.replaceAll('\r\n', '').includes('\n') ? '\r\n' : '\n';
}
