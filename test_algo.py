import numpy as np

stations = np.array([
    [242.2850, 51.4601, 0.0000],
    [232.5098, 203.2263, 0.0000],
    [194.7250, 202.9968, 0.0000],
    [54.1986, 25.8443, 0.0000],
    [19.0551, 38.8050, 0.0000],
    [24.0318, 256.6638, 0.0000],
    [219.8505, 141.6513, 0.0000],
    [127.7784, 166.5764, 0.0000],
    [18.9269, 263.2007, 0.0000],
    [264.0234, 28.9548, 0.0000],
])

observed_times = np.array([64.1809, 50.8475, 44.2845, 57.5096, 56.871, 38.1444, 51.4844, 35.9829, 39.4683, 69.7389])

def calculate_travel_times(hypo_coords, t0, stations, vp):
    distances = np.linalg.norm(stations - hypo_coords, axis=1)
    arrival_times = t0 + (distances / vp)
    return arrival_times, distances

vp = 5.6
best_coords = np.array([10.0, 10.0, 15.0])

mean_travel_time_guess = np.mean(np.linalg.norm(stations - best_coords, axis=1) / vp)
best_t0 = np.mean(observed_times) - mean_travel_time_guess

predicted_times, distances = calculate_travel_times(best_coords, best_t0, stations, vp)
residuals = observed_times - predicted_times
best_rms = np.sqrt(np.mean(residuals ** 2))

max_iterations = 15
convergence_limit = 0.001

for phase in ['depth_fixed', 'depth_free']:
    print(f">>> Starting Phase: {phase.upper()} <<<")
    successive_increases = 0
    theta_sq = 0.005

    for iteration in range(max_iterations):
        predicted_times, distances = calculate_travel_times(best_coords, best_t0, stations, vp)
        residuals = observed_times - predicted_times
        current_rms = np.sqrt(np.mean(residuals ** 2))
        best_rms = current_rms

        T = (best_coords - stations) / (vp * distances[:, np.newaxis])
        Tc = T - np.mean(T, axis=0)
        residuals_c = residuals - np.mean(residuals)

        col_norms = np.linalg.norm(Tc, axis=0)
        col_norms = np.where(col_norms < 1e-10, 1e-10, col_norms)

        S = np.diag(1.0 / col_norms)
        Tcs = Tc @ S

        step_accepted = False
        I = np.eye(3)
        dX = np.zeros(3)

        while not step_accepted:
            G_matrix = Tcs.T @ Tcs + (theta_sq * I)
            dX_scaled = np.linalg.inv(G_matrix) @ Tcs.T @ residuals_c
            dX = S @ dX_scaled

            if phase == 'depth_fixed':
                dX[2] = 0.0

            test_coords = best_coords + dX

            if test_coords[2] < 0:
                successive_increases += 1
                theta_sq *= 4.0
                if successive_increases >= 5:
                    break
                continue

            test_mean_travel = np.mean(np.linalg.norm(stations - test_coords, axis=1) / vp)
            test_t0 = np.mean(observed_times) - test_mean_travel
            test_predicted, _ = calculate_travel_times(test_coords, test_t0, stations, vp)
            test_rms = np.sqrt(np.mean((observed_times - test_predicted) ** 2))

            if test_rms >= current_rms:
                successive_increases += 1
                theta_sq *= 4.0
                if successive_increases >= 5:
                    break
            else:
                step_accepted = True
                best_coords = test_coords
                best_t0 = test_t0
                best_rms = test_rms
                theta_sq *= 0.6
                successive_increases = 0

        if successive_increases >= 5:
            break

        print(f"Iter {iteration + 1} | RMS: {best_rms:.4f} | ThetaSq: {theta_sq:.3e} | Coords: [{best_coords[0]:.2f}, {best_coords[1]:.2f}, {best_coords[2]:.2f}]")

        if step_accepted and np.linalg.norm(dX) < convergence_limit:
            break
