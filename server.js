require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Variabel untuk menyimpan data sementara
let currentStudyData = null;
let currentQuizData = null;

// Route utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/study', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'study.html'));
});

app.get('/quiz', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});

// API untuk generate materi belajar
app.post('/api/generate-study', async (req, res) => {
    try {
        const { title, image } = req.body;
        
        if (!title || !image) {
            return res.status(400).json({ error: 'Title dan image harus diisi' });
        }

        const prompt = `Jelaskan materi "${title}" bahasa yg sederhana dan diksi mudah dimengerti layaknya anda menjelaskan ke anak 15 tahun berisi analogi sederhana.
        
        Format respon harus dalam JSON dengan struktur:
        {
            "title": "judul materi",
            "sections": [
                {
                    "heading": "judul bagian",
                    "content": "penjelasan detail"
                }
            ]
        }
        
        Buat minimal 5-10 bagian pembelajaran yang mudah dipahami dan interaktif. Setiap bagian harus memiliki penjelasan yang cukup detail tapi tidak terlalu panjang per bagian.
        berikan juga kesimpulan di bagian terakhir terkait materi "${title}" `;

        const requestBody = {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: image.split(',')[1] // Remove data:image/jpeg;base64, prefix
                        }
                    }
                ]
            }]
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': process.env.GEMINI_API_KEY
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error?.message || 'Error dari Gemini API');
        }

        let studyContent;
        try {
            const rawText = data.candidates[0].content.parts[0].text;
            // Bersihkan response dari markdown code blocks
            const cleanedText = rawText.replace(/```json\n?|\n?```/g, '').trim();
            studyContent = JSON.parse(cleanedText);
        } catch (parseError) {
            // Fallback jika tidak bisa parse JSON
            const rawText = data.candidates[0].content.parts[0].text;
            studyContent = {
                title: title,
                sections: [{
                    heading: "Materi Pembelajaran",
                    content: rawText
                }]
            };
        }

        currentStudyData = studyContent;
        res.json({ success: true, data: studyContent });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Terjadi kesalahan saat memproses permintaan: ' + error.message });
    }
});

// API untuk mendapatkan data study
app.get('/api/study-data', (req, res) => {
    if (!currentStudyData) {
        return res.status(404).json({ error: 'Data pembelajaran tidak ditemukan' });
    }
    res.json(currentStudyData);
});

// API untuk generate quiz
// Variabel untuk status quiz generation
let isGeneratingQuiz = false;
let quizGenerationStartTime = null;

// API untuk memulai generate quiz
app.post('/api/start-quiz-generation', async (req, res) => {
    try {
        if (!currentStudyData) {
            return res.status(400).json({ error: 'Tidak ada materi untuk dijadikan quiz' });
        }

        if (isGeneratingQuiz) {
            return res.json({ 
                success: true, 
                status: 'processing', 
                message: 'Quiz sedang dalam proses pembuatan' 
            });
        }

        // Set status sedang generate
        isGeneratingQuiz = true;
        quizGenerationStartTime = Date.now();
        currentQuizData = null;

        // Kirim response langsung, proses dilanjutkan di background
        res.json({ 
            success: true, 
            status: 'started', 
            message: 'Pembuatan quiz dimulai' 
        });

        // Proses generate quiz di background
        try {
            const prompt = `Berdasarkan materi pembelajaran tentang "${currentStudyData.title}", buatlah 10 soal pilihan ganda dengan diksi sederhana yang menguji pemahaman siswa, terkait materi tersebut.

            Format respon harus dalam JSON dengan struktur:
            {
                "title": "Quiz: ${currentStudyData.title}",
                "questions": [
                    {
                        "question": "pertanyaan",
                        "options": ["A. pilihan 1", "B. pilihan 2", "C. pilihan 3", "D. pilihan 4"],
                        "correct": 0,
                        "explanation": "penjelasan jawaban yang benar"
                    }
                ]
            }
            
            Pastikan soal bervariasi dari mudah hingga sedang, dan setiap soal memiliki 4 pilihan jawaban.`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-goog-api-key': process.env.GEMINI_API_KEY
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }]
                })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error?.message || 'Error dari Gemini API');
            }

            let quizContent;
            try {
                const rawText = data.candidates[0].content.parts[0].text;
                const cleanedText = rawText.replace(/```json\n?|\n?```/g, '').trim();
                quizContent = JSON.parse(cleanedText);
            } catch (parseError) {
                throw new Error('Gagal memproses format quiz dari AI');
            }

            currentQuizData = quizContent;
            
        } catch (error) {
            console.error('Error generating quiz:', error);
        } finally {
            // Reset status generate
            isGeneratingQuiz = false;
        }

    } catch (error) {
        console.error('Error:', error);
        isGeneratingQuiz = false;
        res.status(500).json({ error: 'Terjadi kesalahan saat memulai pembuatan quiz: ' + error.message });
    }
});

// API untuk mengecek status quiz generation
app.get('/api/quiz-status', (req, res) => {
    if (isGeneratingQuiz) {
        const elapsedTime = Date.now() - quizGenerationStartTime;
        return res.json({ 
            status: 'processing', 
            message: `Quiz sedang dibuat... (${Math.floor(elapsedTime / 1000)} detik)`,
            elapsedTime 
        });
    }
    
    if (currentQuizData) {
        return res.json({ 
            status: 'completed', 
            message: 'Quiz siap' 
        });
    }
    
    res.json({ 
        status: 'not_started', 
        message: 'Quiz belum dimulai' 
    });
});

// API untuk mendapatkan data quiz (tetap sama)
app.get('/api/quiz-data', (req, res) => {
    if (!currentQuizData) {
        return res.status(404).json({ error: 'Data quiz tidak ditemukan' });
    }
    res.json(currentQuizData);
});

app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});