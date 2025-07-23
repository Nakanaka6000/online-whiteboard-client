document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://online-whiteboard-server.onrender.com');

    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    const toolbar = document.getElementById('toolbar');
    const statusLight = document.getElementById('status-light');
    const imageUploadBtn = document.getElementById('image-upload-btn');
    const imageInput = document.getElementById('image-input');
    const textBtn = document.getElementById('text-btn');

    let drawnElements = []; // Stores all drawn lines and images
    let currentPath = []; // Stores points for the current drawing path

    // Canvas setup
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let state = {
        isDrawing: false,
        isDraggingElement: false,
        isResizing: false,
        resizeHandle: null, // 'tl', 'tr', 'bl', 'br'
        selectedElementId: null,
        dragOffsetX: 0,
        dragOffsetY: 0,
        isTyping: false,
        lastX: 0,
        lastY: 0,
        strokeColor: 'black',
        strokeWidth: 5,
        tool: 'pen' // 'pen', 'eraser', 'text', or 'select' for element manipulation
    };

    // --- Tool selection ---
    toolbar.addEventListener('click', (e) => {
        if (e.target.id === 'clear-btn') {
            socket.emit('clear');
            return;
        }
        if (e.target.id === 'image-upload-btn') {
            imageInput.click(); // Hidden file input
            return;
        }
        if (e.target.classList.contains('tool')) {
            document.querySelector('.tool.active').classList.remove('active');
            e.target.classList.add('active');
            state.tool = e.target.id === 'pen-btn' ? 'pen' : (e.target.id === 'eraser-btn' ? 'eraser' : (e.target.id === 'text-btn' ? 'text' : 'select'));
        }
        if (e.target.classList.contains('color-btn')) {
            document.querySelector('.color-btn.active').classList.remove('active');
            e.target.classList.add('active');
            state.strokeColor = e.target.dataset.color;
        }
    });

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const maxWidth = canvas.width * 0.8;
                const maxHeight = canvas.height * 0.8;
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width *= ratio;
                    height *= ratio;
                }

                const x = (canvas.width - width) / 2;
                const y = (canvas.height - height) / 2;

                const newImage = {
                    id: Date.now(), // Unique ID for the image
                    type: 'image',
                    dataURL: event.target.result,
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    img: img // Store the Image object directly
                };
                drawnElements.push(newImage);
                redrawAllElements();

                // Emit image data to other clients
                socket.emit('image', {
                    id: newImage.id,
                    dataURL: newImage.dataURL,
                    x: newImage.x,
                    y: newImage.y,
                    width: newImage.width,
                    height: newImage.height
                });
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    // --- Drawing logic ---
    const getMousePos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const startDrawing = (e) => {
        e.preventDefault();
        const { x, y } = getMousePos(e);

        if (state.tool === 'select') {
            // Check if a resize handle is clicked
            if (state.selectedElementId) {
                const selectedElement = drawnElements.find(el => el.id === state.selectedElementId);
                if (selectedElement && selectedElement.type === 'image') {
                    const handleSize = 16;
                    const handles = {
                        tl: { x: selectedElement.x, y: selectedElement.y },
                        tr: { x: selectedElement.x + selectedElement.width, y: selectedElement.y },
                        bl: { x: selectedElement.x, y: selectedElement.y + selectedElement.height },
                        br: { x: selectedElement.x + selectedElement.width, y: selectedElement.y + selectedElement.height }
                    };

                    for (const handle in handles) {
                        const hx = handles[handle].x;
                        const hy = handles[handle].y;
                        if (x >= hx - handleSize / 2 && x <= hx + handleSize / 2 &&
                            y >= hy - handleSize / 2 && y <= hy + handleSize / 2) {
                            state.isResizing = true;
                            state.resizeHandle = handle;
                            state.lastX = x;
                            state.lastY = y;
                            return;
                        }
                    }
                }
            }

            // Check if an element (image or text) is clicked (for dragging)
            for (let i = drawnElements.length - 1; i >= 0; i--) {
                const el = drawnElements[i];
                if (el.type === 'image' && x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) {
                    state.isDraggingElement = true;
                    state.selectedElementId = el.id;
                    state.dragOffsetX = x - el.x;
                    state.dragOffsetY = y - el.y;
                    redrawAllElements(); // Redraw to show handles
                    return;
                } else if (el.type === 'text') {
                    // For text, we need to calculate its bounding box
                    ctx.font = `${el.fontSize} ${el.fontFamily}`;
                    const textMetrics = ctx.measureText(el.text);
                    const textWidth = textMetrics.width;
                    // For multi-line text, approximate height
                    const textHeight = parseInt(el.fontSize) * 1.2 * el.text.split('\n').length;

                    // Check if click is within text bounding box
                    // Note: text y is baseline, so check from y - textHeight to y
                    if (x >= el.x && x <= el.x + textWidth && y >= el.y - textHeight && y <= el.y) {
                        state.isDraggingElement = true;
                        state.selectedElementId = el.id;
                        state.dragOffsetX = x - el.x;
                        state.dragOffsetY = y - el.y;
                        redrawAllElements();
                        return;
                    }
                }
            }
            state.selectedElementId = null; // Deselect if no element clicked
            redrawAllElements(); // Redraw to hide handles
            return; // Exit if select tool is active and no element was selected for dragging/resizing
        }

        if (state.tool === 'text') {
            state.isTyping = true;
            const inputX = x;
            const inputY = y;

            const textArea = document.createElement('textarea');
            textArea.style.position = 'absolute';
            textArea.style.left = `${inputX}px`;
            textArea.style.top = `${inputY}px`;
            textArea.style.fontSize = '16px'; // Default small size
            textArea.style.fontFamily = 'sans-serif';
            textArea.style.border = '1px solid #ccc';
            textArea.style.padding = '5px';
            textArea.style.background = 'rgba(255,255,255,0.9)';
            textArea.style.zIndex = '100';
            textArea.style.resize = 'none';
            textArea.style.overflow = 'hidden';
            textArea.rows = 1;
            document.body.appendChild(textArea);
            textArea.focus();

            textArea.addEventListener('input', () => {
                textArea.style.height = 'auto';
                textArea.style.height = (textArea.scrollHeight) + 'px';
            });

            textArea.addEventListener('blur', () => {
                if (textArea.value.trim() !== '') {
                    const newText = {
                        id: Date.now(),
                        type: 'text',
                        text: textArea.value,
                        x: inputX,
                        y: inputY,
                        fontSize: '16px',
                        fontFamily: 'sans-serif',
                        color: state.strokeColor // Use current stroke color for text
                    };
                    drawnElements.push(newText);
                    redrawAllElements();
                    socket.emit('text', newText);
                }
                document.body.removeChild(textArea);
                state.isTyping = false;
            });

            textArea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    textArea.blur();
                }
            });
            return;
        }

        state.isDrawing = true;
        state.lastX = x;
        state.lastY = y;

        // If we reach here, it means it's a drawing tool (pen or eraser)
        const drawData = {
            type: 'start',
            x: x,
            y: y,
            tool: state.tool,
            strokeColor: state.strokeColor,
            strokeWidth: state.tool === 'eraser' ? 20 : 5
        };
        currentPath = [drawData];
        socket.emit('drawing', drawData);
        drawOnCanvas(drawData);
    };

    const draw = (e) => {
        if (!state.isDrawing && !state.isDraggingElement && !state.isResizing || state.isTyping) return;
        e.preventDefault();
        const { x, y } = getMousePos(e);

        if (state.isResizing && state.selectedElementId !== null) {
            const elementToResize = drawnElements.find(el => el.id === state.selectedElementId);
            if (elementToResize && elementToResize.type === 'image') { // Ensure it's an image
                const dx = x - state.lastX;
                const dy = y - state.lastY;

                switch (state.resizeHandle) {
                    case 'tl':
                        elementToResize.x += dx;
                        elementToResize.y += dy;
                        elementToResize.width -= dx;
                        elementToResize.height -= dy;
                        break;
                    case 'tr':
                        elementToResize.y += dy;
                        elementToResize.width += dx;
                        elementToResize.height -= dy;
                        break;
                    case 'bl':
                        elementToResize.x += dx;
                        elementToResize.width -= dx;
                        elementToResize.height += dy;
                        break;
                    case 'br':
                        elementToResize.width += dx;
                        elementToResize.height += dy;
                        break;
                }
                // Prevent negative width/height
                elementToResize.width = Math.max(10, elementToResize.width);
                elementToResize.height = Math.max(10, elementToResize.height);

                redrawAllElements();
                socket.emit('elementUpdate', { id: elementToResize.id, x: elementToResize.x, y: elementToResize.y, width: elementToResize.width, height: elementToResize.height });
            }
            state.lastX = x;
            state.lastY = y;
            return;
        }

        if (state.isDraggingElement && state.selectedElementId !== null) {
            const selectedElement = drawnElements.find(el => el.id === state.selectedElementId);
            if (selectedElement) {
                selectedElement.x = x - state.dragOffsetX;
                selectedElement.y = y - state.dragOffsetY;
                redrawAllElements();
                socket.emit('elementUpdate', { id: selectedElement.id, x: selectedElement.x, y: selectedElement.y });
            }
            return;
        }

        if (!state.isDrawing) return; // Should not happen if isDrawing is true

        if (state.tool !== 'select') {
            const drawData = {
                type: 'draw',
                x: x,
                y: y,
                lastX: state.lastX,
                lastY: state.lastY,
                tool: state.tool,
                strokeColor: state.strokeColor,
                strokeWidth: state.tool === 'eraser' ? 20 : 5
            };
            currentPath.push(drawData);
            socket.emit('drawing', drawData);
            drawOnCanvas(drawData);

            state.lastX = x;
            state.lastY = y;
        }
    };

    const stopDrawing = () => {
        if (state.isDrawing && state.tool !== 'select') {
            const drawData = { type: 'stop' };
            currentPath.push(drawData);
            drawnElements.push({ type: 'path', path: currentPath, strokeColor: state.strokeColor, strokeWidth: state.tool === 'eraser' ? 20 : 5 });
            socket.emit('drawing', drawData);
            drawOnCanvas(drawData);
        }
        state.isDrawing = false;
        state.isDraggingElement = false;
        state.isResizing = false;
        state.resizeHandle = null;
        currentPath = [];
        redrawAllElements(); // Ensure handles are hidden after resize/drag
    };

    // --- Canvas drawing function ---
    const drawOnCanvas = (data) => {
        const originalCompositeOperation = ctx.globalCompositeOperation;
        if (data.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        }

        switch (data.type) {
            case 'start':
                ctx.beginPath();
                ctx.moveTo(data.x, data.y);
                break;
            case 'draw':
                ctx.beginPath();
                ctx.moveTo(data.lastX, data.lastY);
                ctx.lineTo(data.x, data.y);
                ctx.strokeStyle = data.tool === 'eraser' ? 'rgba(0,0,0,1)' : data.strokeColor; // Eraser draws transparent
                ctx.lineWidth = data.strokeWidth;
                ctx.stroke();
                break;
            case 'stop':
                ctx.closePath();
                break;
        }
        ctx.globalCompositeOperation = originalCompositeOperation; // Reset to default
    };

    const redrawAllElements = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const nonEraserElements = drawnElements.filter(el => !(el.type === 'path' && el.tool === 'eraser'));
        const eraserElements = drawnElements.filter(el => el.type === 'path' && el.tool === 'eraser');

        // Draw non-eraser elements first
        nonEraserElements.forEach(el => {
            if (el.type === 'path') {
                ctx.strokeStyle = el.strokeColor;
                ctx.lineWidth = el.strokeWidth;
                ctx.beginPath();
                el.path.forEach((point, index) => {
                    if (point.type === 'start') {
                        ctx.moveTo(point.x, point.y);
                    } else if (point.type === 'draw') {
                        ctx.lineTo(point.x, point.y);
                    }
                });
                ctx.stroke();
            } else if (el.type === 'image') {
                ctx.drawImage(el.img, el.x, el.y, el.width, el.height);

                // Draw resize handles if this image is selected
                if (state.selectedElementId === el.id && el.type === 'image') {
                    const handleSize = 16;
                    ctx.fillStyle = '#a0c4ff';
                    ctx.strokeStyle = '#000';
                    ctx.lineWidth = 1;

                    // Top-left
                    ctx.fillRect(el.x - handleSize / 2, el.y - handleSize / 2, handleSize, handleSize);
                    ctx.strokeRect(el.x - handleSize / 2, el.y - handleSize / 2, handleSize, handleSize);
                    // Top-right
                    ctx.fillRect(el.x + el.width - handleSize / 2, el.y - handleSize / 2, handleSize, handleSize);
                    ctx.strokeRect(el.x + el.width - handleSize / 2, el.y - handleSize / 2, handleSize, handleSize);
                    // Bottom-left
                    ctx.fillRect(el.x - handleSize / 2, el.y + el.height - handleSize / 2, handleSize, handleSize);
                    ctx.strokeRect(el.x - handleSize / 2, el.y + el.height - handleSize / 2, handleSize, handleSize);
                    // Bottom-right
                    ctx.fillRect(el.x + el.width - handleSize / 2, el.y + el.height - handleSize / 2, handleSize, handleSize);
                    ctx.strokeRect(el.x + el.width - handleSize / 2, el.y + el.height - handleSize / 2, handleSize, handleSize);
                }
            } else if (el.type === 'text') {
                ctx.font = `${el.fontSize} ${el.fontFamily}`;
                ctx.fillStyle = el.color;
                // Split text into lines and draw each line
                const lines = el.text.split('\n');
                let currentY = el.y;
                for (const line of lines) {
                    ctx.fillText(line, el.x, currentY);
                    currentY += parseInt(el.fontSize) * 1.2; // Line height
                }
            }
        });

        // Draw eraser elements last
        eraserElements.forEach(el => {
            const originalCompositeOperation = ctx.globalCompositeOperation;
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)'; // Eraser draws transparent
            ctx.lineWidth = el.strokeWidth;
            ctx.beginPath();
            el.path.forEach((point, index) => {
                if (point.type === 'start') {
                    ctx.moveTo(point.x, point.y);
                } else if (point.type === 'draw') {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.stroke();
            ctx.globalCompositeOperation = originalCompositeOperation; // Reset to default
        });
    };

    // --- Event Listeners ---
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        redrawAllElements(); // Redraw all elements on resize
    });

    // --- Socket.IO Listeners ---
    socket.on('connect', () => {
        statusLight.className = 'connected';
        statusLight.title = '✅ 接続完了';
    });

    socket.on('disconnect', () => {
        statusLight.className = 'disconnected';
        statusLight.title = '❌ 接続が切れました';
    });

    socket.on('drawing', (data) => {
        // Reconstruct path for remote drawing
        if (data.type === 'start') {
            currentPath = [data];
        } else if (data.type === 'draw') {
            currentPath.push(data);
        } else if (data.type === 'stop') {
            drawnElements.push({ type: 'path', path: currentPath, strokeColor: data.strokeColor, strokeWidth: data.strokeWidth, tool: data.tool });
            currentPath = [];
        }
        redrawAllElements();
    });

    socket.on('clear', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawnElements = []; // Clear all elements
        redrawAllElements(); // Ensure canvas is truly clear and elements array is empty
    });

    socket.on('image', (imageData) => {
        const img = new Image();
        img.onload = () => {
            const newImage = {
                id: imageData.id,
                type: 'image',
                dataURL: imageData.dataURL,
                x: imageData.x,
                y: imageData.y,
                width: imageData.width,
                height: imageData.height,
                img: img
            };
            drawnElements.push(newImage);
            redrawAllElements();
        };
        img.src = imageData.dataURL;
    });

    socket.on('elementUpdate', (updateData) => {
        const elementToUpdate = drawnElements.find(el => el.id === updateData.id);
        if (elementToUpdate) {
            elementToUpdate.x = updateData.x;
            elementToUpdate.y = updateData.y;
            if (updateData.width !== undefined) elementToUpdate.width = updateData.width;
            if (updateData.height !== undefined) elementToUpdate.height = updateData.height;
            redrawAllElements();
        }
    });

    socket.on('text', (textData) => {
        drawnElements.push(textData);
        redrawAllElements();
    });

    socket.on('initialState', (initialElements) => {
        drawnElements = []; // Clear existing elements
        const loadImagePromises = [];

        initialElements.forEach(el => {
            if (el.type === 'image') {
                const img = new Image();
                const promise = new Promise(resolve => {
                    img.onload = () => {
                        el.img = img; // Attach loaded image object
                        drawnElements.push(el);
                        resolve();
                    };
                });
                img.src = el.dataURL;
                loadImagePromises.push(promise);
            } else {
                drawnElements.push(el);
            }
        });

        Promise.all(loadImagePromises).then(() => {
            redrawAllElements();
        });
    });
});