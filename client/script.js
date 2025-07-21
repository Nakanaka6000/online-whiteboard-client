document.addEventListener('DOMContentLoaded', () => {
    const socket = io('https://online-whiteboard-server.onrender.com');

    const canvas = document.getElementById('whiteboard');
    const ctx = canvas.getContext('2d');
    const toolbar = document.getElementById('toolbar');
    const statusLight = document.getElementById('status-light');
    const imageUploadBtn = document.getElementById('image-upload-btn');
    const imageInput = document.getElementById('image-input');

    // Canvas setup
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let state = {
        isDrawing: false,
        lastX: 0,
        lastY: 0,
        strokeColor: 'black',
        strokeWidth: 5,
        tool: 'pen' // 'pen' or 'eraser'
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
            state.tool = e.target.id === 'pen-btn' ? 'pen' : 'eraser';
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
                // Initial draw: center the image, scale down if too large
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

                ctx.drawImage(img, x, y, width, height);

                // Emit image data to other clients
                socket.emit('image', {
                    dataURL: event.target.result,
                    x: x,
                    y: y,
                    width: width,
                    height: height
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
        state.isDrawing = true;
        state.lastX = x;
        state.lastY = y;

        const drawData = {
            type: 'start',
            x: x,
            y: y,
            tool: state.tool,
            strokeColor: state.strokeColor,
            strokeWidth: state.tool === 'eraser' ? 20 : 5
        };
        socket.emit('drawing', drawData);
        drawOnCanvas(drawData);
    };

    const draw = (e) => {
        if (!state.isDrawing) return;
        e.preventDefault();
        const { x, y } = getMousePos(e);

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
        socket.emit('drawing', drawData);
        drawOnCanvas(drawData);

        state.lastX = x;
        state.lastY = y;
    };

    const stopDrawing = () => {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        socket.emit('drawing', { type: 'stop' });
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

    // --- Event Listeners ---
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);

    window.addEventListener('resize', () => {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.putImageData(imageData, 0, 0);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
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
        drawOnCanvas(data);
    });

    socket.on('clear', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('image', (imageData) => {
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, imageData.x, imageData.y, imageData.width, imageData.height);
        };
        img.src = imageData.dataURL;
    });
});