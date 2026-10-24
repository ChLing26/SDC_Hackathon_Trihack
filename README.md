---

# SmartSME Procurement

-> An AI powered procurement platform that helps SMEs identify the best suppliers, optimize purchasing decisions, detect unusual costs, and streamline order management.

---

## Team Information

| Field                  | Details                                     |
| ---------------------- | ------------------------------------------- |
| **Team Name**          | TriHack                                     |
| **Team Domain**        | Domain 2                                    |
| **SDG Track (1–17)**   | SDG 8-DECENT WORK AND ECONOMIC GROWTH, SDG 9-Industry&Innovation&Infastructure, SDG 17-Patnership for the goals|
| **Team Leader**        | Ng Xin Rou                                  |
| **University**         | Xiamen University Malaysia                  |
| **Number of Members**  | 5                                           |

## Links

| Resource          | Link                                           |
| ----------------- | ----------------------------------------------------------- |
| GitHub Repository | https://github.com/ChLing26/SDC_Hackathon_Trihack/tree/main |
| Live Demo         | https://tri-hack-sdc-hackaton.replit.app                    |
| Slide Deck        | https://example.com/slides                     |
| Demo Video        | https://example.com/demo-video                 |

---

## Overview

### Problem

SMEs often face difficulties identifying reliable suppliers and comparing prices, shipping fees, delivery times, and supplier locations. Manual procurement processes can be time-consuming and may lead to higher purchasing costs, inefficient supplier selection, and limited visibility into unusual charges. These challenges make it harder for SMEs to make cost-effective and informed purchasing decisions.

### Solution

SmartSME Procurement is an AI powered procurement platform designed to help SMEs make smarter and more efficient purchasing decisions. It evaluates suppliers based on key factors such as price, shipping fees, delivery time, and distance to generate supplier recommendations. The platform also provides AI powered purchasing advice, flags potentially unusual delivery fees, and supports order management and PDF e-invoice generation to streamline the procurement process.

### Key Features

- **AI-Powered Supplier Recommendation** — Evaluates suppliers based on price, shipping fees, delivery time, and distance to help SMEs identify suitable suppliers.
- **Supplier Scoring and Comparison** — Calculates and compares supplier scores to support transparent, data-driven purchasing decisions.
- **AI Smart Advice** — Uses the Gemini API to provide purchasing insights and recommendations based on available procurement data.
- **Order Management and E-Invoice Generation** — Supports order approval workflows and generates PDF e-invoices from finalized order data.

### Tech Stack

| Layer         | Technology                   |
| ------------- | ---------------------------- |
| Frontend      | React, TypeScript            |
| Backend       | Python, FastAPI              |
| Database      | SQLITE                       |
| AI / Compute  | Google Gemini API            |
| Hosting / Dev | Replit                       |

---

## Project Structure

```
SmartSME-Procurement/
├── docs/                   # Screenshots, diagrams, documentation
├── src/                    # Application source code
│   ├── main.py             # Application entry point
│   ├── api/                # API routes and endpoints
│   ├── services/           # Supplier recommendation, scoring, AI advice
│   ├── database/           # Database connection and data operations
│   └── models/             # Data models and schemas
├── tests/                  # Automated tests
├── .env.example            # Example environment variables
├── .gitignore              # Files excluded from Git
├── requirements.txt        # Python dependencies
└── README.md               # Project documentation
```

### Architecture

```
User ──► Replit Fronted ──► Python Backend (FastAPI) ──► Procurement Results ──► User(SME)
                                 │
                                 └──► SQLITE
                                 └──► GEMINI API
                                 └──► Supplier Scoring
---

## How to Run

### Option 1 — Run on Replit (Recommended)

1. Open the [TriHack_SDC Hackaton]()
2. Open the **Secrets** tab and add the required environment variables from `.env.example`, such as:
   - `GEMINI_API_KEY`
   - `PYTHON_BACKEND_TOKEN`
   - `AI_INTEGRATIONS_OPENAI_BASE_URL`
   - `AI_INTEGRATIONS_OPENAI_API_KEY`
   - `SESSION_SECRET`
3. Install the required dependencies if they are not installed automatically:
   ```bash
   pip install -r requirements.txt
   ```
4. Click **Run**. Replit starts the application using the project's configured run command.

### Option 2 — Run Locally

**Prerequisites**
- Python 3.10 or later
- Git
- A Gemini API key 
  
```bash
# 1. Clone the repository
git clone https://github.com/ChLing26/SDC_Hackathon_Trihack.git
cd SDC_Hackathon_Trihack

# 2. Create and activate a virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment variables
# Copy .env.example to .env, then fill in your values
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env

# 5. Run the application
# Use the actual entry point configured in your project
python main.py
```.


### Run Tests

```bash
python -m unittest discover tests
```

---

## How We Use Replit 

- **Development:** Our team uses Replit to develop and integrate the SmartSME Procurement application and its procurement-related features.
- **Hosting:** Replit is used to run or deploy the application for demonstration, depending on the project's deployment configuration.
- **Secrets:** API keys, including the Gemini API key, are configured through Replit Secrets and are not hardcoded in the source code.

📄 Proof of use: [`submission/SDC2026_TriHack_Replit_POU.pdf`](file:///C:/xin%20rou/Documents/Competition/SDC%20Hackaton/proof%20of%20use/submission_SDC2026_TriHack_Replit_POU.pdf)


## Challenges & Learnings

- What challenges did you face, and how did you overcome them?
  Integrating the frontend, FastAPI backend, database, and Gemini API required careful coordination. The team also faced challenges with environment configuration, Git collaboration, and testing the application across different components.
- What did your team learn?
  The team learned how to develop and integrate APIs, manage database records, configure environment variables securely, collaborate through GitHub, and apply AI to support real-world SME procurement decisions.
  
## Future Improvements

- [ ] Improvement 1:Enhanced Supplier Intelligence: Integrate more supplier data and historical purchasing records to improve recommendation accuracy and supplier reliability assessment.
- [ ] Improvement 2:Advanced Procurement Analytics: Add interactive dashboards, spending trend analysis, and more comprehensive anomaly detection to help SMEs make better purchasing decisions.

## Team

| Name        | Role                | GitHub                                          |
| ----------- | ------------------- | ------------------------------------------------|
| Ng Xin Rou  | Team Lead / Backend | 2006NXR(https://github.com/2006NXR)             |
| Tan Xin Hui | Frontend /AI        | tanhuiling59(https://github.com/tanhuiling59)   |
| Tan Hui Ling| Frontend            | xinhuitan0731（https://github.com/xinhuitan0731)|
| Chong Ling  | Backend             | ChLing26(https://github.com/ChLing26)           |
| Ong Yi Soong| AI / RunPod         | SlokeNg(https://github.com/SlokeOng)            |

---

## Submission Checklist

- [/] Team name, domain (Domain 1 / Domain 2) and SDG track filled in
- [ ] Slide deck link added
- [ ] Demo video link added
- [/] Replit used, with proof of use in `submission/`
- [/] Preliminary submission completed (`SDC2026_TeamName_Preliminary.pdf`)
- [/] Technology declaration completed (`SDC2026_TeamName_TechDeclaration.pdf`)
- [/] Submission files renamed with your team name (replace `TeamName`)
- [/] "How to Run" steps verified
- [ ] No API keys or secrets committed to the repository

## License

This project is licensed under the [Apache License 2.0](LICENSE).
