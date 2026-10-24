import requests
from geopy.geocoders import Nominatim


OSRM_URL = "https://router.project-osrm.org/route/v1/driving"
geolocator = Nominatim(user_agent="stationery_supplier_selection_project")


def geocode_address(address):
    location = geolocator.geocode(address, timeout=15)
    if location is None:
        raise ValueError(
            "Address not found. Try entering a more specific address, town, or postcode."
        )
    return location.latitude, location.longitude


def calculate_road_distance(lat1, lon1, lat2, lon2):
    coordinates = f"{lon1},{lat1};{lon2},{lat2}"
    try:
        response = requests.get(
            f"{OSRM_URL}/{coordinates}",
            params={"overview": "false"},
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None, None, "NO_ROUTE"
        route = data["routes"][0]
        return (
            round(route["distance"] / 1000, 2),
            round(route["duration"] / 60, 2),
            "OK",
        )
    except (requests.RequestException, ValueError) as error:
        print(f"Routing error: {error}")
        return None, None, "REQUEST_ERROR"
