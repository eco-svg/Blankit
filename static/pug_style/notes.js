document.addEventListener('DOMContentLoaded', () => {
    // --- 1. UI ELEMENT SELECTORS ---
    const listScreen = document.getElementById('notesListScreen');
    const editorScreen = document.getElementById('notesEditorScreen');
    const noteItemsContainer = document.getElementById('noteItemsContainer');
    
    const btnNewNote = document.getElementById('newNoteBtn');
    const btnBack = document.getElementById('backToListBtn');
    const btnDeleteNote = document.getElementById('deleteNoteBtn');

    const titleInput = document.getElementById('noteTitle');
    const bodyInput = document.getElementById('noteBody');
    const statusIndicator = document.getElementById('saveStatus');
    
    const btnInsertImage = document.getElementById('btnInsertImage');
    const btnInsertVideo = document.getElementById('btnInsertVideo');
    const imageInput = document.getElementById('imageInput');
    const videoInput = document.getElementById('videoInput');

    let typingTimer;
    let currentNoteId = null; 
    const doneTypingInterval = 1000;

    // --- 2. LOAD THE LIST (REFRESH VIEW) ---
    function loadNotesList() {
        fetch('/api/notes')
            .then(res => res.json())
            .then(notes => {
                noteItemsContainer.innerHTML = ''; // Clear container
                
                if (notes.length === 0) {
                    noteItemsContainer.innerHTML = '<p style="text-align:center; color:var(--text-dim); margin-top:20px;">No flows found. Start one!</p>';
                }

                notes.forEach(note => {
                    const date = new Date(note.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    const el = document.createElement('div');
                    el.className = 'note-item';
                    
                    let rawText = note.body ? note.body.replace(/<[^>]*>?/gm, '') : '';
                    let preview = rawText.substring(0, 40) || 'Empty flow...';
                    
                    el.innerHTML = `
                        <h4>${note.title || 'Untitled Flow'}</h4>
                        <p>${preview}...</p>
                        <span class="note-time">${date}</span>
                    `;
                    
                    el.addEventListener('click', () => {
                        currentNoteId = note.id;
                        titleInput.value = note.title;
                        bodyInput.innerHTML = note.body;
                        listScreen.classList.add('hidden');
                        editorScreen.classList.remove('hidden');
                    });
                    noteItemsContainer.appendChild(el);
                });
            })
            .catch(err => console.error("Error loading list:", err));
    }

    // Run once on startup
    loadNotesList();

    // --- 3. NAVIGATION ---
    btnNewNote.addEventListener('click', () => {
        currentNoteId = null; 
        titleInput.value = '';
        bodyInput.innerHTML = '';
        listScreen.classList.add('hidden');
        editorScreen.classList.remove('hidden');
        titleInput.focus();
    });

    btnBack.addEventListener('click', () => {
        editorScreen.classList.add('hidden');
        listScreen.classList.remove('hidden');
        loadNotesList(); 
    });

    // --- 4. AUTO-SAVE LOGIC ---
    function saveNote() {
        if (!titleInput.value.trim() && !bodyInput.textContent.trim() && bodyInput.innerHTML === '') return;

        statusIndicator.textContent = 'Saving...';
        statusIndicator.style.color = 'var(--accent)';

        const payload = {
            id: currentNoteId, 
            title: titleInput.value,
            body: bodyInput.innerHTML 
        };

        fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                currentNoteId = data.id; 
                statusIndicator.textContent = 'Saved';
                statusIndicator.style.color = 'var(--text-dim)';
            }
        })
        .catch(err => {
            console.error("Save failed:", err);
            statusIndicator.textContent = 'Error';
            statusIndicator.style.color = '#c85a2a';
        });
    }

    function handleTyping() {
        clearTimeout(typingTimer);
        statusIndicator.textContent = 'Typing...';
        statusIndicator.style.color = 'var(--text-muted)';
        typingTimer = setTimeout(saveNote, doneTypingInterval);
    }

    titleInput.addEventListener('input', handleTyping);
    bodyInput.addEventListener('input', handleTyping);

    // --- 5. MEDIA UPLOADER & INJECTION ---
    function insertNodeAtCursor(node) {
        let sel = window.getSelection();
        if (sel.getRangeAt && sel.rangeCount) {
            let range = sel.getRangeAt(0);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            bodyInput.appendChild(node);
        }
        handleTyping(); 
    }

    btnInsertImage.addEventListener('click', () => imageInput.click());
    btnInsertVideo.addEventListener('click', () => videoInput.click());

    function uploadMedia(file, type) {
        statusIndicator.textContent = 'Uploading...';
        statusIndicator.style.color = 'var(--accent)';

        const formData = new FormData();
        formData.append('file', file);

        fetch('/api/upload', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.url) {
                let mediaNode;
                if (type === 'image') {
                    mediaNode = document.createElement('img');
                    mediaNode.src = data.url;
                } else if (type === 'video') {
                    mediaNode = document.createElement('video');
                    mediaNode.src = data.url;
                    mediaNode.controls = true;
                }
                
                insertNodeAtCursor(mediaNode);
                insertNodeAtCursor(document.createElement('br')); 
                
                statusIndicator.textContent = 'Saved';
                statusIndicator.style.color = 'var(--text-dim)';
            }
        })
        .catch(err => {
            console.error("Upload failed:", err);
            statusIndicator.textContent = 'Upload Failed';
        });
    }

    imageInput.addEventListener('change', function() {
        if (this.files[0]) { uploadMedia(this.files[0], 'image'); this.value = ''; }
    });

    videoInput.addEventListener('change', function() {
        if (this.files[0]) {
            if (this.files[0].size > 50 * 1024 * 1024) {
                alert("File too large!"); return;
            }
            uploadMedia(this.files[0], 'video'); this.value = '';
        }
    });

    // --- 6. SOFT DELETE LOGIC (Custom UI Modal) ---
    const deleteModal = document.getElementById('deleteModal');
    const btnConfirmDelete = document.getElementById('confirmDeleteBtn');
    const btnCancelDelete = document.getElementById('cancelDeleteBtn');

    // 1. Show the modal when the trash can is clicked
    btnDeleteNote.addEventListener('click', () => {
        if (!currentNoteId) {
            // If it's an unsaved blank note, just exit
            btnBack.click();
            return;
        }
        deleteModal.classList.remove('hidden');
    });

    // 2. Hide the modal if they click Cancel
    btnCancelDelete.addEventListener('click', () => {
        deleteModal.classList.add('hidden');
    });

    // 3. Execute the delete if they confirm
    btnConfirmDelete.addEventListener('click', () => {
        
        // Optional: Change button text to show it's working
        const originalText = btnConfirmDelete.textContent;
        btnConfirmDelete.textContent = "Deleting...";
        
        fetch(`/api/notes/${currentNoteId}`, {
            method: 'DELETE'
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                deleteModal.classList.add('hidden'); 
                currentNoteId = null; 
                btnBack.click();      
                loadNotesList();      
            }
        })
        .catch(err => {
            console.error("Failed to delete:", err);
            alert("Delete failed. Check connection.");
        })
        .finally(() => {
            // Reset button text no matter what
            btnConfirmDelete.textContent = originalText;
        });
    });
});