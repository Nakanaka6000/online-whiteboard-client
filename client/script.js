document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://online-whiteboard-server.onrender.com');

    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    const toolbar = document.getElementById('toolbar');
    const statusLight = document.getElementById('status-light');
    const imageUploadBtn = document.getElementById('image-upload-btn');
    const imageInput = document.getElementById('image-input');

    let drawnElements = []; // Stores all drawn lines and images
    let currentPath = []; // Stores points for the current drawing path

    // Canvas setup
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let state = {
        isDrawing: false,
        isDraggingImage: false,
        selectedImageId: null,
        dragOffsetX: 0,
        dragOffsetY: 0,
        lastX: 0,
        lastY: 0,
        strokeColor: 'black',
        strokeWidth: 5,
        tool: 'pen' // 'pen', 'eraser', or 'select' for image manipulation
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
            state.tool = e.target.id === 'pen-btn' ? 'pen' : (e.target.id === 'eraser-btn' ? 'eraser' : 'select');
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
            // Check if an image is clicked
            for (let i = drawnElements.length - 1; i >= 0; i--) {
                const el = drawnElements[i];
                if (el.type === 'image' && x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) {
                    state.isDraggingImage = true;
                    state.selectedImageId = el.id;
                    state.dragOffsetX = x - el.x;
                    state.dragOffsetY = y - el.y;
                    return;
                }
            }
            state.selectedImageId = null; // Deselect if no image clicked
        }

        state.isDrawing = true;
        state.lastX = x;
        state.lastY = y;

        if (state.tool !== 'select') {
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
        }
    };

    const draw = (e) => {
        if (!state.isDrawing && !state.isDraggingImage) return;
        e.preventDefault();
        const { x, y } = getMousePos(e);

        if (state.isDraggingImage && state.selectedImageId !== null) {
            const imageToMove = drawnElements.find(el => el.id === state.selectedImageId);
            if (imageToMove) {
                imageToMove.x = x - state.dragOffsetX;
                imageToMove.y = y - state.dragOffsetY;
                redrawAllElements();
                socket.emit('imageUpdate', { id: imageToMove.id, x: imageToMove.x, y: imageToMove.y });
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
        state.isDraggingImage = false;
        state.selectedImageId = null;
        currentPath = [];
    };

    // --- Canvas drawing function ---
    const drawOnCanvas = (data) => {
        switch (data.type) {
            case 'start':
                ctx.beginPath();
                ctx.moveTo(data.x, data.y);
                break;
            case 'draw':
                ctx.beginPath();
                ctx.moveTo(data.lastX, data.lastY);
                ctx.lineTo(data.x, data.y);
                ctx.strokeStyle = data.tool === 'eraser' ? '#FFFFFF' : data.strokeColor;
                ctx.lineWidth = data.strokeWidth;
                ctx.stroke();
                break;
            case 'stop':
                ctx.closePath();
                break;
        }
    };

    const redrawAllElements = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawnElements.forEach(el => {
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
            }
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
            drawnElements.push({ type: 'path', path: currentPath, strokeColor: data.strokeColor, strokeWidth: data.strokeWidth });
            currentPath = [];
        }
        redrawAllElements();
    });

    socket.on('clear', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawnElements = []; // Clear all elements
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

    socket.on('imageUpdate', (updateData) => {
        const imageToUpdate = drawnElements.find(el => el.id === updateData.id);
        if (imageToUpdate) {
            imageToUpdate.x = updateData.x;
            imageToUpdate.y = updateData.y;
            redrawAllElements();
        }
    });
});