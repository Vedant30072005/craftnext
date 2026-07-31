const collectionsEl = document.getElementById('collections');
const statusEl = document.getElementById('status');

function renderCollections(data) {
  const sections = Object.entries(data)
    .map(([name, entries]) => {
      const items = entries.length
        ? `<ul>${entries.map((entry) => `<li>${entry}</li>`).join('')}</ul>`
        : '<p class="empty">No folders found.</p>';

      return `<article class="collection"><h3>${name}</h3>${items}</article>`;
    })
    .join('');

  collectionsEl.innerHTML = sections;
}

fetch('/api/collections')
  .then((response) => response.json())
  .then((data) => {
    renderCollections(data);
    statusEl.textContent = 'Live';
  })
  .catch(() => {
    collectionsEl.innerHTML = '<p class="empty">Unable to load collections.</p>';
    statusEl.textContent = 'Offline';
  });