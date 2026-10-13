const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تشغيل واجهة المستخدم
app.use(express.static('public'));

const rooms = {};
const GRID_SIZE = 5; // شبكة 5x5 للعب السريع

function generateCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
    // إنشاء غرفة
    socket.on('createRoom', () => {
        const code = generateCode();
        rooms[code] = {
            p1: socket.id,
            p2: null,
            state: 'waiting',
            turn: socket.id,
            players: {
                [socket.id]: { x: 0, y: 0, traps: [] }
            }
        };
        socket.join(code);
        socket.emit('roomCreated', code);
    });

    // الانضمام لغرفة
    socket.on('joinRoom', (code) => {
        const room = rooms[code];
        if (room && room.state === 'waiting') {
            room.p2 = socket.id;
            room.state = 'playing';
            // وضع اللاعب التاني في الزاوية العكسية
            room.players[socket.id] = { x: GRID_SIZE - 1, y: GRID_SIZE - 1, traps: [] };
            socket.join(code);
            io.to(code).emit('gameStarted');
            sendGameState(code);
        } else {
            socket.emit('errorMsg', 'الكود غلط أو الغرفة مليانة!');
        }
    });

    // الحركة
    socket.on('move', ({ code, dx, dy }) => {
        const room = rooms[code];
        if (!room || room.state !== 'playing' || room.turn !== socket.id) return;

        const player = room.players[socket.id];
        const opponentId = room.p1 === socket.id ? room.p2 : room.p1;
        const opponent = room.players[opponentId];

        let nx = player.x + dx;
        let ny = player.y + dy;

        // التأكد إن الحركة جوه المربع
        if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
            player.x = nx;
            player.y = ny;

            // هل داس على فخ؟
            const hitTrap = opponent.traps.some(t => t.x === nx && t.y === ny);
            // هل خبط في اللاعب التاني؟ (صيده)
            const hitPlayer = opponent.x === nx && opponent.y === ny;

            if (hitTrap) {
                io.to(socket.id).emit('gameOver', { won: false, msg: 'دوست على فخ الخصم! خسرت 💀' });
                io.to(opponentId).emit('gameOver', { won: true, msg: 'الخصم وقع في الفخ بتاعك! كسبت 🏆' });
                room.state = 'finished';
                return;
            }
            if (hitPlayer) {
                io.to(socket.id).emit('gameOver', { won: true, msg: 'لقيت الخصم وقبضت عليه! كسبت 🏆' });
                io.to(opponentId).emit('gameOver', { won: false, msg: 'الخصم مسكك! خسرت 💀' });
                room.state = 'finished';
                return;
            }

            // نقل الدور للخصم
            room.turn = opponentId;
            sendGameState(code);
        }
    });

    // زرع فخ
    socket.on('placeTrap', ({ code }) => {
        const room = rooms[code];
        if (!room || room.state !== 'playing' || room.turn !== socket.id) return;
        
        const player = room.players[socket.id];
        const opponentId = room.p1 === socket.id ? room.p2 : room.p1;

        if (player.traps.length < 3) {
            player.traps.push({ x: player.x, y: player.y });
            room.turn = opponentId;
            sendGameState(code);
        }
    });

    function sendGameState(code) {
        const room = rooms[code];
        if (!room) return;

        [room.p1, room.p2].forEach(playerId => {
            const opponentId = room.p1 === playerId ? room.p2 : room.p1;
            const player = room.players[playerId];
            const opponent = room.players[opponentId];

            // حساب المسافة لمعرفة لو في خطر (الرادار)
            const dist = Math.abs(player.x - opponent.x) + Math.abs(player.y - opponent.y);
            const isDanger = dist === 1;

            // إرسال البيانات المسموح بيها فقط لكل لاعب!
            io.to(playerId).emit('updateState', {
                myTurn: room.turn === playerId,
                x: player.x,
                y: player.y,
                traps: player.traps,
                radar: isDanger,
                trapsLeft: 3 - player.traps.length
            });
        });
    }
});

server.listen(3000, () => {
    console.log('Game Server is running on port 3000');
});