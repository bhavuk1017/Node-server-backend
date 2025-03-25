const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection.useDb("certification_platform");
const test_results_collection = db.collection("test_results");
// Violation schema and model
const violationSchema = new mongoose.Schema({
  type: String,
  timestamp: { type: Date, default: Date.now },
});

const Violation = mongoose.model("Violation", violationSchema);


// Log violations (POST)
app.post("/log-violation", async (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ error: "Violation type is required" });
  
  try {
    const violation = new Violation({ type });
    await violation.save();
    return res.json({ message: "Violation logged", violation });
  } catch (err) {
    console.error("Error logging violation:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Fetch all violations (GET)
app.get("/violations", async (req, res) => {
  try {
    const violations = await Violation.find().sort({ timestamp: -1 }); // Latest first
    return res.json(violations);
  } catch (err) {
    console.error("Error fetching violations:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Generate AI response (proxy to GROQ API)
app.post("/generate-ai-response", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });
  
  try {
    // FIX: Correct the authorization header format
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 700
      },
      {
        headers: {
          // Remove the "GROQ_API=" prefix from the token
          "Authorization": `Bearer ${process.env.GROQ_API}`,
          "Content-Type": "application/json"
        }
      }
    );
    
    return res.json({ 
      result: response.data.choices[0].message.content 
    });
  } catch (err) {
    console.error("Error generating AI response:", err);
    return res.status(500).json({ error: "Error generating AI response" });
  }
});

// Submit test answers (POST)
app.post("/submit-test", async (req, res) => {
  const { email, skill, questions, answers } = req.body;
  
  if (!email || !skill || !questions || !answers) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  try {
    // Generate the evaluation prompt
    const evaluationPrompt = `
      Evaluate the following answers based on the given test questions. 
      Provide a score out of 10, and return the result in this format strictly:
      
      Score: X/10
      
      Feedback: (Detailed feedback on each answer)
      
      ${questions.map((q, i) => `**Q${i+1}**: ${q}\n**A${i+1}**: ${answers[i]}\n\n`).join('')}
    `;
    
    // Call the AI to evaluate the test
    const evaluationResponse = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: evaluationPrompt }],
        max_tokens: 700
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API}`,
          "Content-Type": "application/json"
        }
      }
    );
    
    const evaluation = evaluationResponse.data.choices[0].message.content;
    
    // Extract score using regex
    const scoreMatch = evaluation.match(/Score:\s*(\d+)\/10/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
    
    // Save test result directly to MongoDB
    const testResult = {
      email,
      skill,
      score,
      date: new Date(),
      questions,
      answers,
      feedback: evaluation
    };

    await test_results_collection.insertOne(testResult);
    
    // Return the score and evaluation to React
    return res.json({ 
      score: score,
      evaluation: evaluation,
      passed: score >= 5
    });
  } catch (err) {
    console.error("Error submitting test:", err);
    return res.status(500).json({ error: "Error submitting test" });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});