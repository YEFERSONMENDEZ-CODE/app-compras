# Despensa - Product Requirements

## Overview
Modern mobile app for tracking monthly grocery shopping. Users manage favorite markets, add products (with unit or kg + quantity + price), scan receipts via camera with AI (GPT-5.4 OCR), create shopping lists with price comparison across markets, and get monthly reports with charts. Multi-currency (PYG default, USD, EUR, BRL, ARS).

## Tech Stack
- **Frontend**: Expo React Native + expo-router (5 bottom tabs)
- **Backend**: FastAPI + MongoDB (motor)
- **Auth**: Emergent Managed Google OAuth (7-day session_token)
- **AI/OCR**: emergentintegrations LlmChat with GPT-5.4 (vision)
- **Charts**: react-native-gifted-charts
- **UI**: lucide-react-native icons, expo-camera, expo-image-picker

## Features
- Google Login (Emergent Auth)
- Markets CRUD (name + color)
- Purchases CRUD + Edit + Delete (products with name, quantity, unit un/kg, price, category, per-market and per-currency; total = price × quantity)
- Receipt scanning: camera → AI extracts products → prefills add-purchase form
- **Shopping Lists**: create lists; add items manually OR from history of past purchases; per-product price comparison across markets (cheapest highlighted); mark items as bought (with paid price, quantity, market) or as unavailable ("no había")
- Monthly Reports: total, purchases count, item count, donut chart by category, bar chart by market
- Multi-currency: PYG (default), USD, EUR, BRL, ARS
- Settings: profile + currency picker + logout

## Endpoints
- `POST /api/auth/session` — exchange session_id for session_token
- `GET /api/auth/me`, `POST /api/auth/logout`, `PUT /api/auth/currency`
- `GET/POST/PUT/DELETE /api/markets`
- `GET/POST/PUT/DELETE /api/purchases`
- `GET /api/reports/monthly?month=YYYY-MM`
- `POST /api/receipt/scan` — OCR receipt
- `GET/POST/PUT/DELETE /api/shopping-lists` and nested `/items`
- `GET /api/products/history?q=<optional>` — aggregate products from past purchases with cheapest-market comparison
- `GET /api/currencies`

## Config
- `newArchEnabled: false` in app.json (Expo Go iOS compat)
- expo 54.0.37, expo-constants 18.0.14 pinned via yarn resolve
