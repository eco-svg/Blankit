/**
 * notes.js — Notes — create / edit / delete personal notes.
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM References ---
    // Grabbing all the elements we need once at the top.
    // If any of these return null (element doesn't exist in HTML), we'd crash.
    // That's why we check before using them.
    const listScreen          = document.getElementById('notesListScreen');
    const editorScreen        = document.getElementById('notesEditorScreen');
    const noteItemsContainer  = document.getElementById('noteItemsContainer');
    const btnNewNote          = document.getElementById('newNoteBtn');
    const btnBack             = document.getElementById('backToListBtn');
    const btnDeleteNote       = document.getElementById('deleteNoteBtn');
    const titleInput          = document.getElementById('noteTitle');
    const bodyInput           = document.getElementById('noteBody');
    const statusIndicator     = document.getElementById('saveStatus');
    const dateInput           = document.getElementById('noteDateInput');
    const imageInput          = document.getElementById('imageInput');
    const videoInput          = document.getElementById('videoInput');
    const deleteModal         = document.getElementById('deleteModal');
    const btnConfirmDelete    = document.getElementById('confirmDeleteBtn');
    const btnCancelDelete     = document.getElementById('cancelDeleteBtn');

    // --- State ---
    let typingTimer    = null;
    let currentNoteId  = null;
    let savedRange     = null; // last known cursor position inside bodyInput
    const TYPING_DELAY = 1000; // ms to wait after user stops typing before saving
    let notesCache     = [];   // avoid refetch on Back — update locally after save

    // --- Limits ---
    const MAX_IMAGE_MB    = 5;
    const MAX_VIDEO_MB    = 50;
    const MAX_VIDEO_SECS  = 120;  // 2 minutes hard cap


    // =========================================================
    // SECTION 1: NOTES LIST
    // =========================================================

    function renderNotesList(notes) {
        noteItemsContainer.innerHTML = '';
        if (notes.length === 0) {
            noteItemsContainer.innerHTML = '<p style="text-align:center; color:var(--text-dim); margin-top:20px;">No flows yet. Start one!</p>';
            return;
        }
        notes.forEach(note => {
            const date = new Date(note.updated_at).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric'
            });
            const rawText = note.body ? note.body.replace(/<[^>]*>/gm, '') : '';
            const preview = rawText.substring(0, 40) || 'Empty flow...';
            const el = document.createElement('div');
            el.className = 'note-item';
            el.innerHTML = `
                <h4>${note.title || 'Untitled Flow'}</h4>
                <p>${preview}...</p>
                <span class="note-time">${date}</span>
            `;
            el.addEventListener('click', () => openNote(note));
            noteItemsContainer.appendChild(el);
        });
    }

    function loadNotesList() {
        fetch('/pug/api/notes')
            .then(res => res.json())
            .then(notes => {
                notesCache = notes;
                renderNotesList(notes);
            })
            .catch(err => console.error("Notes list error:", err));
    }

    function openNote(note) {
        // Populate editor fields with the clicked note's data
        currentNoteId      = note.id;
        titleInput.value   = note.title || '';
        bodyInput.innerHTML = note.body  || '';

        // Set date picker if the note has a start date
        if (dateInput) {
            dateInput.value = note.start_datetime ? note.start_datetime.split('T')[0] : '';
        }

        // Toggle screens: hide list, show editor
        // classList.add/remove manipulates CSS classes on an element
        listScreen.classList.add('hidden');
        editorScreen.classList.remove('hidden');
    }

    // Load notes immediately when the page is ready
    loadNotesList();


    // =========================================================
    // SECTION 2: NAVIGATION BUTTONS
    // =========================================================

    btnNewNote.addEventListener('click', () => {
        // Reset state for a fresh note
        currentNoteId       = null;
        titleInput.value    = '';
        bodyInput.innerHTML = '';
        if (dateInput) dateInput.value = '';

        listScreen.classList.add('hidden');
        editorScreen.classList.remove('hidden');
        titleInput.focus(); // auto-focus the title field — small UX touch
    });

    btnBack.addEventListener('click', () => {
        editorScreen.classList.add('hidden');
        listScreen.classList.remove('hidden');
        renderNotesList(notesCache); // instant — no server round-trip
    });


    // =========================================================
    // SECTION 3: AUTO-SAVE WITH DEBOUNCE
    // =========================================================

    function saveNote() {
        // Don't save if both title and body are empty
        const hasContent = titleInput.value.trim() || bodyInput.textContent.trim();
        if (!hasContent) return;

        setStatus('Saving...', 'var(--accent)');

        const payload = {
            id:             currentNoteId,    // null = create new, number = update existing
            title:          titleInput.value,
            body:           bodyInput.innerHTML, // innerHTML keeps images/videos inside the editor
            start_datetime: dateInput ? dateInput.value || null : null
        };

        fetch('/pug/api/notes', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
            // JSON.stringify turns a JS object into a JSON string for the request body
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                currentNoteId = data.id;
                // Keep cache in sync so Back renders correct preview instantly
                const idx = notesCache.findIndex(n => n.id === data.id);
                const now = new Date().toISOString();
                if (idx !== -1) {
                    notesCache[idx] = { ...notesCache[idx], title: titleInput.value, body: bodyInput.innerHTML, updated_at: now };
                    notesCache.unshift(notesCache.splice(idx, 1)[0]); // bubble to top
                } else {
                    notesCache.unshift({ id: data.id, title: titleInput.value, body: bodyInput.innerHTML, updated_at: now });
                }
                setStatus('Saved', 'var(--text-dim)');
                if (window.refreshNexusCalendar) window.refreshNexusCalendar();
            }
        })
        .catch(() => setStatus('Save failed', 'var(--accent2)'));
    }

    function handleTyping() {
        // Debounce: cancel the previous timer, start a new 1s countdown
        // This means save only fires 1s after the LAST keystroke
        clearTimeout(typingTimer);
        setStatus('Typing...', 'var(--text-muted)');
        typingTimer = setTimeout(saveNote, TYPING_DELAY);
    }

    function setStatus(text, color) {
        if (!statusIndicator) return;
        statusIndicator.textContent = text;
        statusIndicator.style.color  = color;
    }

    titleInput.addEventListener('input',  handleTyping);
    bodyInput.addEventListener('input',   handleTyping);
    if (dateInput) dateInput.addEventListener('change', handleTyping);

    // Ctrl+S / Cmd+S manual save
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault(); // stops browser's "save page" dialog
            clearTimeout(typingTimer);
            saveNote();
        }
    });


    // =========================================================
    // SECTION 4: MEDIA UPLOAD WITH VALIDATION
    // =========================================================

    // Save cursor position whenever user interacts with the editor
    bodyInput.addEventListener('keyup',    saveCursor);
    bodyInput.addEventListener('mouseup',  saveCursor);
    bodyInput.addEventListener('touchend', saveCursor);

    function saveCursor() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && bodyInput.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            savedRange = sel.getRangeAt(0).cloneRange();
        }
    }

    function insertNodeAtCursor(node) {
        bodyInput.focus();
        const sel = window.getSelection();
        // Restore saved range if current selection is outside the editor
        if (savedRange && sel && (
            !sel.rangeCount || !bodyInput.contains(sel.getRangeAt(0).commonAncestorContainer)
        )) {
            sel.removeAllRanges();
            sel.addRange(savedRange);
        }
        if (sel && sel.getRangeAt && sel.rangeCount &&
            bodyInput.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
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

    function uploadMedia(file, type) {
        // --- Size check ---
        const maxBytes = (type === 'image' ? MAX_IMAGE_MB : MAX_VIDEO_MB) * 1024 * 1024;
        // 1024 * 1024 = 1MB in bytes. file.size is in bytes.
        if (file.size > maxBytes) {
            setStatus(`Too large. Max ${type === 'image' ? MAX_IMAGE_MB + 'MB' : MAX_VIDEO_MB + 'MB'}`, 'var(--accent2)');
            return;
        }

        // --- Video duration check ---
        // We can only check duration AFTER the browser loads the file metadata.
        // So we create a temporary <video> element, load the file into it,
        // and wait for the 'loadedmetadata' event which fires once duration is known.
        if (type === 'video') {
            const tempVideo = document.createElement('video');
            tempVideo.preload = 'metadata'; // only load metadata, not the full video
            tempVideo.src = URL.createObjectURL(file);
            // createObjectURL makes a temporary local URL for the file

            tempVideo.addEventListener('loadedmetadata', () => {
                URL.revokeObjectURL(tempVideo.src); // free the memory
                if (tempVideo.duration > MAX_VIDEO_SECS) {
                    setStatus(`Max video length is 2 minutes`, 'var(--accent2)');
                    return;
                }
                // Duration is fine — proceed to upload
                doUpload(file, type);
            });

            tempVideo.addEventListener('error', () => {
                URL.revokeObjectURL(tempVideo.src);
                setStatus('Could not read video file', 'var(--accent2)');
            });

            return; // wait for loadedmetadata before uploading
        }

        // Images skip the duration check and go straight to upload
        doUpload(file, type);
    }

    function doUpload(file, type) {
        setStatus('Uploading...', 'var(--text-muted)');

        // FormData is used for file uploads — it encodes the file as multipart/form-data
        // which is what the browser naturally uses for <input type="file"> forms
        const formData = new FormData();
        formData.append('file', file);

        fetch('/pug/api/upload', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.url) {
                const mediaNode = document.createElement(type === 'image' ? 'img' : 'video');
                mediaNode.src = data.url;
                if (type === 'video') {
                    mediaNode.controls = true; // show video controls (play/pause/etc)
                    mediaNode.preload  = 'metadata';
                }
                insertNodeAtCursor(mediaNode);
                insertNodeAtCursor(document.createElement('br'));
                setStatus('Saved', 'var(--text-dim)');
            } else {
                setStatus('Upload failed', 'var(--accent2)');
            }
        })
        .catch(() => setStatus('Upload error', 'var(--accent2)'));
    }

    // These fire when the user selects a file via the label click
    // The label in HTML handles opening the file picker — no JS needed for that part
    imageInput.addEventListener('change', function () {
        if (this.files[0]) {
            uploadMedia(this.files[0], 'image');
            this.value = ''; // reset so same file can be picked again
        }
    });

    videoInput.addEventListener('change', function () {
        if (this.files[0]) {
            uploadMedia(this.files[0], 'video');
            this.value = '';
        }
    });


    // =========================================================
    // SECTION 5: DELETE FLOW
    // =========================================================

    btnDeleteNote.addEventListener('click', () => {
        if (!currentNoteId) {
            btnBack.click(); // nothing saved yet, just go back
            return;
        }
        deleteModal.classList.remove('hidden');
    });

    btnCancelDelete.addEventListener('click', () => {
        deleteModal.classList.add('hidden');
    });

    btnConfirmDelete.addEventListener('click', () => {
        btnConfirmDelete.textContent = 'Deleting...';

        fetch(`/pug/api/notes/${currentNoteId}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                notesCache = notesCache.filter(n => n.id !== currentNoteId);
                deleteModal.classList.add('hidden');
                if (window.refreshNexusCalendar) window.refreshNexusCalendar();
                btnBack.click();
            }
        })
        .catch(() => setStatus('Delete failed', 'var(--accent2)'))
        .finally(() => { btnConfirmDelete.textContent = 'Delete Forever'; });
        // .finally() runs regardless of success or failure — good for cleanup
    });

});