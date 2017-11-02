const { URL } = require('url');
const { promisify } = require('util');
const { toLaxTitleCase: titleCase } = require('titlecase');
const fetch = require('node-fetch');
const distance = require('@turf/distance');
const moment = require('moment');
const map = require('async/map');
const etag = require('etag');

const asyncMap = promisify(map);
const appName = process.env.APPLICATION;
const ONE_DAY = 1000 * 60 * 60 * 24;

if (!appName) {
	throw new Error('Please set your application name in the `APPLICATION` environment variable.');
}

let stations = new Map();

async function fetchStations() {
	const response = await fetch('https://tidesandcurrents.noaa.gov/mdapi/v0.6/webapi/tidepredstations.json');
	const json = await response.json();
	stations = new Map(json.stationList.map((station) => [station.stationId, station]));
}

setInterval(fetchStations, ONE_DAY);
fetchStations();

const fetchPredictionsForStation = async (station, days = 2) => {
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

const formatName = (name) => {
	return titleCase(`${name}`.toLowerCase().replace('u.s.', 'U.S.'));
};

const formatStation = (station) => ({
	id: station.stationId,
	name: formatName(station.etidesStnName),
	commonName: formatName(station.commonName),
	lat: parseFloat(station.lat),
	lon: parseFloat(station.lon),
	distance: station.distance
});

const formatPrediction = (prediction, timeZoneCorrection) => {
	const parsedTime = moment(`${prediction.t} ${timeZoneCorrection}`, 'YYYY-MM-DD HH:mm Z');

	return {
		type: prediction.type === 'H' ? 'high' : 'low',
		height: parseFloat(prediction.v),
		time: parsedTime.toString(),
		unixTime: parsedTime.unix()
	};
};

const calculateDistanceToStation = (lon, lat, station) => {
	const fromPoint = [
		parseFloat(lon),
		parseFloat(lat)
	];

	const stationPoint = [
		parseFloat(station.lon),
		parseFloat(station.lat)
	];

	return distance(fromPoint, stationPoint);
};

const getStationPredictions = async (station, days) => {
	const tides = await fetchPredictionsForStation(station, days);
	return {
		...formatStation(station),
		predictions: tides.predictions.map((prediction) => formatPrediction(prediction, station.timeZoneCorr))
	};
};

const closestHandler = async (lat, lon) => {
	const stationsWithDistances = Array.from(stations.values()).map((station) => ({
		...station,
		distance: calculateDistanceToStation(lon, lat, station)
	}));

	stationsWithDistances.sort((a, b) => a.distance - b.distance);

	const stationsWithPredictions = await asyncMap(stationsWithDistances.slice(0, 10), async (station) => getStationPredictions(station));
	return JSON.stringify(stationsWithPredictions);
};

const individualStationHandler = async (stationId) => {
	const station = stations.get(stationId);
	const response = await getStationPredictions(station, 5);
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
