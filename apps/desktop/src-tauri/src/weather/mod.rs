//! Weather commands: thin chains over `net` (fixed hosts) and `open_meteo` (pure logic).

pub mod open_meteo;

use crate::net::{Endpoint, NetClient};
use open_meteo::{Forecast, Place, WeatherError};

#[tauri::command]
pub async fn weather_forecast(
    net: tauri::State<'_, NetClient>,
    latitude: f64,
    longitude: f64,
) -> Result<Forecast, WeatherError> {
    let (latitude, longitude) = open_meteo::validate_coordinates(latitude, longitude)?;
    let pairs = open_meteo::forecast_query(latitude, longitude);
    let url = Endpoint::OpenMeteoForecast.url(&pairs);
    let body = net.get_json(Endpoint::OpenMeteoForecast, url).await?;
    open_meteo::parse_forecast(&body)
}

#[tauri::command]
pub async fn weather_geocode(
    net: tauri::State<'_, NetClient>,
    query: String,
    language: String,
) -> Result<Vec<Place>, WeatherError> {
    let query = open_meteo::validate_query(&query)?;
    let language = open_meteo::validate_language(&language)?;
    let pairs = open_meteo::geocode_query(&query, language);
    let url = Endpoint::OpenMeteoGeocoding.url(&pairs);
    let body = net.get_json(Endpoint::OpenMeteoGeocoding, url).await?;
    open_meteo::parse_places(&body)
}
