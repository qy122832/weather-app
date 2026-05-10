#!/usr/bin/env node

async function main() {
  console.log("\n  Fetching your location...\n");

  const geoRes = await fetch("http://ip-api.com/json/");
  const geo = await geoRes.json();

  if (geo.status !== "success") {
    console.error("Failed to get location:", geo.message);
    process.exit(1);
  }

  const { query: ip, city, regionName, country, lat, lon } = geo;

  console.log("  Fetching weather data...\n");

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
  const weatherRes = await fetch(weatherUrl);
  const weather = await weatherRes.json();

  const { temperature, windspeed, winddirection, weathercode } = weather.current_weather;
  const condition = weatherConditions[weathercode] || `Code ${weathercode}`;

  const boxWidth = 44;
  const line = "─".repeat(boxWidth);

  console.log(`  ┌${line}┐`);
  console.log(`  │  ${center("WEATHER REPORT", boxWidth)}│`);
  console.log(`  ├${line}┤`);
  console.log(`  │${pad("  IP", ip, boxWidth)}│`);
  console.log(`  │${pad("  Location", `${city}, ${regionName}, ${country}`, boxWidth)}│`);
  console.log(`  │${pad("  Coordinates", `${lat}, ${lon}`, boxWidth)}│`);
  console.log(`  ├${line}┤`);
  console.log(`  │${pad("  Temperature", `${temperature}°C`, boxWidth)}│`);
  console.log(`  │${pad("  Wind Speed", `${windspeed} km/h`, boxWidth)}│`);
  console.log(`  │${pad("  Wind Direction", `${winddirection}°`, boxWidth)}│`);
  console.log(`  │${pad("  Condition", condition, boxWidth)}│`);
  console.log(`  └${line}┘\n`);
}

function pad(label, value, width) {
  const text = label + ": " + value;
  return text + " ".repeat(width - text.length - 1);
}

function center(text, width) {
  const padding = Math.max(0, width - text.length);
  const left = Math.floor(padding / 2);
  return " ".repeat(left) + text + " ".repeat(padding - left - 1);
}

const weatherConditions = {
  0:  "Clear sky",
  1:  "Mainly clear",
  2:  "Partly cloudy",
  3:  "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

main();
