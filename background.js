// A dedicated page owns work; closing it stops new operations. Local state survives
// both page closure and service-worker suspension. No timers or queues live here.
async function openSyncPage() {
  const url = chrome.runtime.getURL('sync.html');
  const existing = (await chrome.tabs.query({ url })).find(tab => tab.id);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
}
chrome.action.onClicked.addListener(openSyncPage);
// Updating the extension closes the sync page; reopen it so the user can carry on.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') openSyncPage();
});
