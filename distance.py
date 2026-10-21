import requests


OSRM_BASE_URL = "https://router.project-osrm.org"


def get_distance(origin, destination):

#origin and destination use:(longitude, latitude)

    lon1, lat1 = origin
    lon2, lat2 = destination

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

