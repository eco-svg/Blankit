/* ══════════════════════════════
   account.js — shared logout + delete for all distros
   Include this in any page that needs logout/delete buttons.
   Add these elements to your HTML:
     <button id="logoutBtn">Logout</button>
     <button id="deleteAccountBtn">Delete Account</button>
     <div id="deleteModal" style="display:none">
       <p>Type <strong>delete my account</strong> to confirm</p>
       <input id="deleteConfirmInput" type="text" placeholder="delete my account" />
       <button id="deleteConfirmBtn" disabled>Delete permanently</button>
       <button id="deleteCancelBtn">Cancel</button>
     </div>
══════════════════════════════ */

(function () {
  /* ── LOGOUT ── */
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/auth/logout', { method: 'POST' });
      } finally {
        localStorage.removeItem('veyra-locked-distro');
        window.location.href = '/';
      }
    });
  }

  /* ── DELETE ACCOUNT ── */
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');
  const deleteModal      = document.getElementById('deleteModal');
  const deleteConfirmInput = document.getElementById('deleteConfirmInput');
  const deleteConfirmBtn   = document.getElementById('deleteConfirmBtn');
  const deleteCancelBtn    = document.getElementById('deleteCancelBtn');

  if (deleteAccountBtn && deleteModal) {
    deleteAccountBtn.addEventListener('click', () => {
      deleteModal.style.display = 'flex';
      if (deleteConfirmInput) deleteConfirmInput.value = '';
      if (deleteConfirmBtn)   deleteConfirmBtn.disabled = true;
    });
  }

  if (deleteConfirmInput) {
    deleteConfirmInput.addEventListener('input', () => {
      deleteConfirmBtn.disabled = deleteConfirmInput.value.trim() !== 'delete my account';
    });
  }

  if (deleteCancelBtn) {
    deleteCancelBtn.addEventListener('click', () => {
      deleteModal.style.display = 'none';
    });
  }

  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener('click', async () => {
      deleteConfirmBtn.disabled    = true;
      deleteConfirmBtn.textContent = 'Deleting...';
      try {
        const res = await fetch('/auth/delete-account', { method: 'DELETE' });
        if (res.ok) {
          localStorage.removeItem('veyra-locked-distro');
          window.location.href = '/';
        } else {
          const data = await res.json();
          alert(data.error || 'deletion failed');
          deleteConfirmBtn.disabled    = false;
          deleteConfirmBtn.textContent = 'Delete permanently';
        }
      } catch {
        alert('network error');
        deleteConfirmBtn.disabled    = false;
        deleteConfirmBtn.textContent = 'Delete permanently';
      }
    });
  }
})();