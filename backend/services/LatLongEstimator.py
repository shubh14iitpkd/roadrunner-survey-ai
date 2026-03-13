import os
import math


class LatLongEstimator:
    def __init__(self):
        self.camera_height_meters = float(os.environ.get("CAMERA_HEIGHT_METERS", 1.5))
        self.vertical_fov_degrees = float(os.environ.get("VERTICAL_FOV_DEGREES", 40))
        self.camera_tilt_degrees = float(os.environ.get("CAMERA_TILT_DEGREES", 5))
        self.R_EARTH = 6378137.0

    def calculate_bearing_for_frame(self, frame_number, interpolated_gpx, total_frames, frame_interval=1):
        """
        Calculates bearing using a sliding window.
        Robustly handles edges by clamping indices to valid bounds.
        """
        n = len(interpolated_gpx)
        if n <= 1:
            return 0

        raw_prev = frame_number - frame_interval
        raw_next = frame_number + frame_interval

        start_idx = max(0, raw_prev)
        end_idx = min(n - 1, raw_next)

        if start_idx == end_idx:
            if start_idx < n - 1:
                end_idx = start_idx + 1
            elif start_idx > 0:
                start_idx = start_idx - 1
            else:
                return 0

        prev_point = interpolated_gpx[start_idx]
        next_point = interpolated_gpx[end_idx]

        return self.calculate_bearing_from_lat_lon(
            prev_point["lat"], prev_point["lon"],
            next_point["lat"], next_point["lon"]
        )

    def calculate_bearing_from_lat_lon(self, lat1, lon1, lat2, lon2):
        lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
        dLon = lon2 - lon1
        y = math.sin(dLon) * math.cos(lat2)
        x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dLon)
        bearing = math.degrees(math.atan2(y, x))
        return (bearing + 360) % 360

    def get_relative_angle(self, car_bearing, target_bearing):
        diff = target_bearing - car_bearing
        while diff <= -180:
            diff += 360
        while diff > 180:
            diff -= 360
        return diff

    def estimate_location(self, car_lat, car_lon, car_heading, im_width, im_height, bbox):
        bbox_center_x = (bbox[0] + bbox[2]) / 2
        bbox_top_y    = bbox[1]
        bbox_bottom_y = bbox[3]
        bbox_height   = bbox_bottom_y - bbox_top_y

        # Ground contact is ALWAYS the bottom edge — even for tall poles/signs.
        # Only consider truly "overhead" if the bottom itself is above mid-frame
        # (i.e. a genuinely elevated/floating asset, not just a tall one)
        bottom_normalized = bbox_bottom_y / im_height          # 0=top, 1=bottom
        is_truly_overhead = bottom_normalized < 0.5

        # For tall bounding boxes, the object is close — bbox_height as a fraction
        # of frame height gives a useful proximity signal
        bbox_height_ratio = bbox_height / im_height            # 0→1, bigger = closer

        # Distance via ground-contact angle (always use bottom Y)
        offset_y_pixels  = bbox_bottom_y - im_height / 2
        vertical_angle_deg = offset_y_pixels / im_height * self.vertical_fov_degrees
        total_angle_deg  = vertical_angle_deg + self.camera_tilt_degrees

        # Cap distance: tall boxes (big height ratio) should never project far away
        # A bbox taking up >40% of frame height is almost certainly within 20m
        height_based_cap = max(10.0, 200.0 * (1.0 - bbox_height_ratio * 2.0))

        if is_truly_overhead:
            overhead_ratio   = bottom_normalized / 0.5         # 0=top → 1=midframe
            overhead_cap     = 30 + (100 - 30) * (overhead_ratio ** 2)
            max_distance     = min(height_based_cap, overhead_cap)
        else:
            max_distance = min(height_based_cap, 200.0)

        if total_angle_deg < 0.5:
            distance_meters = max_distance
        else:
            distance_meters = self.camera_height_meters / math.tan(math.radians(total_angle_deg))
            distance_meters = min(distance_meters, max_distance)

        # Extra dampener for truly overhead assets only
        if is_truly_overhead:
            overhead_ratio  = bottom_normalized / 0.5
            dampener        = 0.3 + 0.7 * (overhead_ratio ** 1.5)
            distance_meters *= dampener

        # Horizontal bearing (unchanged)
        horizontal_fov_deg = self.vertical_fov_degrees * im_width / im_height
        offset_x_pixels    = bbox_center_x - im_width / 2
        angle_offset_deg   = offset_x_pixels / im_width * horizontal_fov_deg
        object_bearing     = (car_heading + angle_offset_deg) % 360

        d_lat = distance_meters * math.cos(math.radians(object_bearing)) / self.R_EARTH
        d_lon = distance_meters * math.sin(math.radians(object_bearing)) / (
            self.R_EARTH * math.cos(math.radians(car_lat))
        )

        return {
            "lat":      car_lat + math.degrees(d_lat),
            "lon":      car_lon + math.degrees(d_lon),
            "bearing":  object_bearing,
            "dist":     distance_meters,
            "overhead": is_truly_overhead,
        }

    # def estimate_location(self, car_lat, car_lon, car_heading, im_width, im_height, bbox):
    #     """
    #     Estimate the real-world location of an object from its bounding box.

    #     Args:
    #         car_lat, car_lon: Camera/vehicle position
    #         car_heading: Vehicle bearing in degrees
    #         im_width, im_height: Image dimensions in pixels
    #         bbox: [xmin, ymin, xmax, ymax] in pixels

    #     Returns:
    #         dict with lat, lon, bearing, dist
    #     """
    #     bbox_center_x = (bbox[0] + bbox[2]) / 2
    #     bbox_bottom_y = bbox[3]

    #     offset_y_pixels = bbox_bottom_y - im_height / 2
    #     vertical_angle_deg = offset_y_pixels / im_height * self.vertical_fov_degrees
    #     total_angle_deg = vertical_angle_deg + self.camera_tilt_degrees

    #     if total_angle_deg < 0.5:
    #         distance_meters = 200
    #     else:
    #         distance_meters = self.camera_height_meters / math.tan(math.radians(total_angle_deg))
    #         distance_meters = min(distance_meters, 200)

    #     horizontal_fov_deg = self.vertical_fov_degrees * im_width / im_height
    #     offset_x_pixels = bbox_center_x - im_width / 2
    #     angle_offset_deg = offset_x_pixels / im_width * horizontal_fov_deg
    #     object_bearing = (car_heading + angle_offset_deg) % 360

    #     d_lat = distance_meters * math.cos(math.radians(object_bearing)) / self.R_EARTH
    #     d_lon = distance_meters * math.sin(math.radians(object_bearing)) / (
    #         self.R_EARTH * math.cos(math.radians(car_lat))
    #     )

    #     return {
    #         "lat": car_lat + math.degrees(d_lat),
    #         "lon": car_lon + math.degrees(d_lon),
    #         "bearing": object_bearing,
    #         "dist": distance_meters,
    #     }
