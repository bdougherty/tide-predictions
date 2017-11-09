const { URL } = require('url');
const { promisify } = require('util');
const { toLaxTitleCase: titleCase } = require('titlecase');
const fetch = require('node-fetch');
const distance = require('@turf/distance');
const moment = require('moment-timezone');
const geoTz = require('geo-tz');
const map = require('async/map');
const etag = require('etag');

const asyncMap = promisify(map);
const appName = process.env.APPLICATION;
const ONE_DAY = 1000 * 60 * 60 * 24;

if (!appName) {
	throw new Error('Please set your application name in the `APPLICATION` environment variable.');
}

let tideStations = new Map();

async function fetchTideStations() {
	const response = await fetch('https://tidesandcurrents.noaa.gov/mdapi/v0.6/webapi/tidepredstations.json');
	const json = await response.json();
	tideStations = new Map(json.stationList.map((station) => [station.stationId, station]));
}

setInterval(fetchTideStations, ONE_DAY);
fetchTideStations();

const fetchPredictionsForTideStation = async (station, days = 2) => {
	const endpoint = new URL('https://tidesandcurrents.noaa.gov/api/datagetter');
	const params = endpoint.searchParams;
	params.set('station', station.stationId);
	params.set('begin_date', moment().subtract(1, 'day').format('YYYYMMDD'));
	params.set('range', 24 * (days + 2));
	params.set('product', 'predictions');
	params.set('application', appName);
	params.set('datum', 'MLLW');
	params.set('time_zone', 'lst_ldt');
	params.set('units', 'english');
	params.set('interval', 'hilo');
	params.set('format', 'json');

	const response = await fetch(`${endpoint}`);
	const json = await response.json();
	return json;
};

const formatTideStationName = (name) => {
	return titleCase(`${name}`.toLowerCase().replace('u.s.', 'U.S.'));
};

const formatTideStation = (station) => {
	const lat = parseFloat(station.lat);
	const lon = parseFloat(station.lon);
	const tz = geoTz.tz(lat, lon);

	return {
		id: station.stationId,
		name: formatTideStationName(station.etidesStnName),
		commonName: formatTideStationName(station.commonName),
		lat,
		lon,
		state: station.state,
		region: station.region,
		timeZone: tz,
		distance: station.distance
	};
};

const formatTidePrediction = (prediction, station) => {
	const lat = parseFloat(station.lat);
	const lon = parseFloat(station.lon);
	const tz = geoTz.tz(lat, lon);

	const parsedTime = moment.tz(prediction.t, 'YYYY-MM-DD HH:mm', tz);

	return {
		type: prediction.type === 'H' ? 'high' : 'low',
		height: parseFloat(prediction.v),
		time: parsedTime.format(),
		unixTime: parsedTime.unix()
	};
};

const calculateDistance = ([lat1, lon1], [lat2, lon2]) => {
	const fromPoint = [
		parseFloat(lon1),
		parseFloat(lat1)
	];

	const toPoint = [
		parseFloat(lon2),
		parseFloat(lat2)
	];

	return distance(fromPoint, toPoint);
};

const getStationPredictions = async (station, days) => {
	const tides = await fetchPredictionsForTideStation(station, days);
	return {
		...formatTideStation(station),
		predictions: tides.predictions.map((prediction) => formatTidePrediction(prediction, station))
	};
};

const closestHandler = async (lat, lon) => {
	const stationsWithDistances = Array.from(tideStations.values()).map((station) => ({
		...station,
		distance: calculateDistance([lat, lon], [station.lat, station.lon])
	}));

	stationsWithDistances.sort((a, b) => a.distance - b.distance);

	const stationsWithPredictions = await asyncMap(stationsWithDistances.slice(0, 10), async (station) => {
		return getStationPredictions(station);
	});

	return JSON.stringify({
		lat,
		lon,

		stations: stationsWithPredictions
	});
};

const individualStationHandler = async (stationId) => {
	const station = tideStations.get(stationId);
	const response = await getStationPredictions(station, 7);
	return JSON.stringify(response);
};

const setAccessControlHeaders = (res) => {
	res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');
	res.setHeader('Access-Control-Allow-Max-Age', 86400);
};

const setCacheHeaders = (res, data, hours = 1) => {
	res.setHeader('Expires', moment().add(hours, 'hour').utc().format('ddd, D MMM YYYY H:mm:ss [GMT]'));
	res.setHeader('Cache-Control', `public, max-age=${hours * 3600}`);
	res.setHeader('ETag', etag(data));
};

module.exports = async (req, res) => {
	if (req.method !== 'GET' && req.method !== 'OPTIONS') {
		const methodNotAllowedError = new Error('Method Not Allowed');
		methodNotAllowedError.statusCode = 405;
		throw methodNotAllowedError;
	}

	res.setHeader('Access-Control-Allow-Origin', '*');

	let matches = null;

	if ((matches = req.url.match(/^\/tides\/(\d+)$/))) {
		if (req.method === 'OPTIONS') {
			setAccessControlHeaders(res);
			return '';
		}

		const data = await individualStationHandler(matches[1]);
		setCacheHeaders(res, data);
		return data;
	}

	if ((matches = req.url.match(/^\/closest\/([.-\d]+),([.-\d]+)$/))) {
		if (req.method === 'OPTIONS') {
			setAccessControlHeaders(res);
			return '';
		}

		const data = await closestHandler(matches[1], matches[2]);
		setCacheHeaders(res, data);
		return data;
	}

	const notFoundError = new Error('Not Found');
	notFoundError.statusCode = 404;
	throw notFoundError;
};
