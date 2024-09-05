// Function to analyze handwriting based on random simulation
function analyzeHandwriting() {
    const possibleResults = [
        'Your handwriting is neat and beautiful, indicating a strong sense of order and aesthetic appreciation.',
        'Your handwriting is a bit messy, suggesting you are creative, spontaneous, and enjoy thinking outside the box.',
        'Your handwriting is very small and controlled, reflecting a meticulous, detail-oriented personality with a love for precision.',
        'Your handwriting is large and bold, showing confidence and a strong presence in social situations.',
        'Your handwriting has sharp, angular strokes, which could indicate a more analytical and logical mind, but also a tendency towards critical thinking.',
        'Your handwriting is highly slanted and erratic, pointing to a person with emotional depth but also unpredictability and mood swings.',
        'Your handwriting is rounded and smooth, suggesting a warm, compassionate nature and a desire to keep harmony around you.',
        'Your handwriting shows inconsistency in size and shape, indicating a complex personality with varied interests and thoughts.',
        'Your handwriting looks identical to samples studied in forensic psychology for psychopathic tendencies, hinting at traits such as high intelligence, charm, and strategic thinking.'
    ];

    // Randomly select a result from the array
    const randomIndex = Math.floor(Math.random() * possibleResults.length);
    return possibleResults[randomIndex];
}

// Function to preview uploaded image
function previewImage(event) {
    const resultSection = document.getElementById('result-section');
    const preview = document.getElementById('preview');
    const analysisResult = document.getElementById('analysis-result');

    const reader = new FileReader();
    reader.onload = function() {
        preview.src = reader.result;
        preview.style.display = 'block';
        analysisResult.innerText = 'Analyzing your handwriting...';
        
        // Simulate analysis process
        setTimeout(() => {
            analysisResult.innerText = analyzeHandwriting();
        }, 2000);
    }
    reader.readAsDataURL(event.target.files[0]);
}

// Function to open camera and take a photo
function openCamera() {
    const video = document.getElementById('video');
    const captureBtn = document.getElementById('capture-btn');
    
    video.style.display = 'block';
    captureBtn.style.display = 'block';

    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            video.srcObject = stream;
        })
        .catch(error => {
            console.error("Camera access error:", error);
        });
}

// Function to capture photo from video
function capturePhoto() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('2d');
    const resultSection = document.getElementById('result-section');
    const preview = document.getElementById('preview');
    const analysisResult = document.getElementById('analysis-result');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Show the captured photo in the preview section
    preview.src = canvas.toDataURL('image/png');
    preview.style.display = 'block';
    analysisResult.innerText = 'Analyzing your handwriting...';
    
    // Simulate analysis process
    setTimeout(() => {
        analysisResult.innerText = analyzeHandwriting();
    }, 2000);
} 
