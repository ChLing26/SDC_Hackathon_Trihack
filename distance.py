import requests
from math import isfinite


OSRM_BASE_URL = "https://router.project-osrm.org"


def get_distance(origin, destination):

#origin and destination use:(longitude, latitude)

    def coordinates(point):
        try:
            longitude, latitude = (float(value) for value in point)
        except (TypeError, ValueError):
            raise ValueError("Coordinates must be a (longitude, latitude) pair.") from None
        if (
            not isfinite(longitude) or not isfinite(latitude)
            or not -180 <= longitude <= 180 or not -90 <= latitude <= 90
        ):
            raise ValueError("Coordinates are outside valid longitude/latitude ranges.")
        return longitude, latitude

    lon1, lat1 = coordinates(origin)
    lon2, lat2 = coordinates(destination)

    url = (
        f"{OSRM_BASE_URL}/route/v1/driving/"
        f"{lon1},{lat1};{lon2},{lat2}"
    )

    params = {
        "overview": "false"
    }

    response = requests.get(
        url,
        params=params,
        timeout=20
    )

    response.raise_for_status()
    data = response.json()

    if data.get("code") != "Ok" or not data.get("routes"):
        raise ValueError(
            f"OSRM could not find a route: {data}"
        )

    route = data["routes"][0]
    if any(
        not isinstance(route.get(field), (int, float))
        or not isfinite(route[field]) or route[field] < 0
        for field in ("distance", "duration")
    ):
        raise ValueError("OSRM returned invalid distance or duration.")

    return {
        "distance_km": round(
            route["distance"] / 1000, 2
        ),
        "duration_minutes": round(
            route["duration"] / 60, 1
        )
    }


if __name__ == "__main__":
    # Format: (longitude, latitude)
    kuala_lumpur = (101.6869, 3.1390)
    shah_alam = (101.5183, 3.0733)

    try:
        result = get_distance(
            kuala_lumpur,
            shah_alam
        )

        print("Distance API test successful!")
        print("Road distance:", result["distance_km"], "km")
        print(
            "Estimated driving time:",
            result["duration_minutes"],
            "minutes"
        )

    except requests.RequestException as error:
        print("Network or API error:", error)

    except ValueError as error:
        print("Route error:", error)

