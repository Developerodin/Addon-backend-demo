import fetch from 'node-fetch';
import config from '../../config/config.js';

const BASE_URL = 'https://maps.googleapis.com/maps/api/place';

/**
 * Google Places API Service
 * Implements Google Places API Text Search and Place Details
 */
class GooglePlacesService {
  constructor(apiKey = null) {
    this.apiKey = apiKey || config.googlePlaces?.apiKey || process.env.GOOGLE_PLACES_API_KEY;
    if (!this.apiKey) {
      console.warn('Google Places API key not configured. Service will return empty results.');
      console.warn('Please set GOOGLE_PLACES_API_KEY in your .env file');
    } else {
      console.log('Google Places API key loaded successfully');
    }
  }

  /**
   * Search for places using Google Places API Text Search
   * @param {string} query - Search query (e.g., "plumber in Bangalore")
   * @param {string} location - Location bias (optional, e.g., "Bangalore, India" or "lat,lng")
   * @param {number} radius - Search radius in meters (default 3000)
   * @returns {Promise<Array>} - List of place objects
   */
  async textSearch(query, location = null, radius = 3000) {
    if (!this.apiKey) {
      console.warn('Google Places API key not configured');
      return [];
    }

    try {
      const url = `${BASE_URL}/textsearch/json`;
      const params = new URLSearchParams({
        query: query,
        key: this.apiKey,
        type: 'establishment', // Focus on businesses
      });

      // Note: Don't add location parameter with text search - include it in query instead
      // The Flask version uses location=None and includes location in the query string

      console.log(`Google Places text search: query=${query}, location=${location}`);
      const response = await fetch(`${url}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Google Places API request failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status !== 'OK') {
        const errorMsg = `Google Places API error: ${data.status} - ${data.error_message || 'Unknown error'}`;
        console.error(errorMsg);
        // Throw error instead of returning empty array so it can be handled properly
        throw new Error(errorMsg);
      }

      // Normalize results to our Provider structure
      // Note: Text Search doesn't return phone numbers - we'd need Place Details API
      const places = [];
      for (const result of data.results || []) {
        const place = this._normalizePlaceResult(result);
        if (place) {
          places.push(place);
        }
      }

      console.log(`Found ${places.length} places for query: ${query} (phone numbers require Place Details API)`);
      return places;
    } catch (error) {
      console.error(`Google Places API request failed: ${error.message}`);
      // Re-throw error instead of returning empty array
      throw error;
    }
  }

  /**
   * Get detailed information about a place using place_id
   * @param {string} placeId - Google Places place_id
   * @returns {Promise<Object|null>} - Place details or null
   */
  async getPlaceDetails(placeId) {
    if (!this.apiKey) {
      console.warn('Google Places API key not configured');
      return null;
    }

    try {
      const url = `${BASE_URL}/details/json`;
      const params = new URLSearchParams({
        place_id: placeId,
        key: this.apiKey,
        fields: 'name,formatted_phone_number,international_phone_number,formatted_address,geometry,rating,user_ratings_total,business_status,price_level,types,website,opening_hours',
      });

      console.log(`Fetching place details for: ${placeId}`);
      const response = await fetch(`${url}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Google Places Details API request failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status !== 'OK') {
        const errorMsg = `Google Places Details API error: ${data.status} - ${data.error_message || 'Unknown error'}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      return this._normalizePlaceDetails(data.result || {});
    } catch (error) {
      console.error(`Google Places Details API request failed: ${error.message}`);
      throw error; // Re-throw instead of returning null
    }
  }

  /**
   * Normalize Google Places API result to our Provider structure
   * @param {Object} result - Google Places API result
   * @returns {Object|null} - Normalized provider object
   */
  _normalizePlaceResult(result) {
    try {
      const geometry = result.geometry || {};
      const location = geometry.location || {};

      // Extract city, state, country from address_components
      const addressComponents = result.address_components || [];
      let city = null;
      let state = null;
      let country = 'India';

      for (const component of addressComponents) {
        const types = component.types || [];
        if (types.includes('locality')) {
          city = component.long_name;
        } else if (types.includes('administrative_area_level_2')) {
          // Sometimes city is in administrative_area_level_2
          if (!city) {
            city = component.long_name;
          }
        } else if (types.includes('administrative_area_level_1')) {
          state = component.long_name;
        } else if (types.includes('country')) {
          country = component.long_name;
        }
      }

      // Fallback: Try to extract city from formatted_address if not found
      if (!city && result.formatted_address) {
        // Common pattern: "..., City, State, Country"
        const addressParts = result.formatted_address.split(',');
        if (addressParts.length >= 2) {
          // Usually city is second to last or third to last
          // Try to find a part that looks like a city name
          for (let i = addressParts.length - 3; i >= 0 && i >= addressParts.length - 5; i--) {
            const part = addressParts[i].trim();
            // Skip if it's a number or very short
            if (part.length > 2 && !/^\d+/.test(part)) {
              city = part;
              break;
            }
          }
        }
      }

      // Extract service type from types (first relevant type)
      const types = result.types || [];
      let serviceType = null;
      
      // Try to find a meaningful service type
      const serviceTypeKeywords = ['plumber', 'electrician', 'carpenter', 'painter', 'mechanic', 'contractor', 'repair'];
      for (const t of types) {
        const typeLower = t.toLowerCase();
        // Check if type matches any service keyword
        for (const keyword of serviceTypeKeywords) {
          if (typeLower.includes(keyword)) {
            serviceType = keyword;
            break;
          }
        }
        if (serviceType) break;
      }
      
      // If no service type found, use first non-generic type
      if (!serviceType) {
        for (const t of types) {
          if (!['establishment', 'point_of_interest', 'store', 'premise', 'route', 'street_address'].includes(t)) {
            serviceType = t.replace(/_/g, ' ');
            break;
          }
        }
      }

      return {
        place_id: result.place_id,
        name: result.name,
        address: result.formatted_address,
        city: city,
        state: state,
        country: country,
        latitude: location.lat,
        longitude: location.lng,
        rating: result.rating,
        review_count: result.user_ratings_total || 0,
        business_status: result.business_status || 'OPERATIONAL',
        price_level: result.price_level,
        service_type: serviceType,
        phone: result.formatted_phone_number || result.international_phone_number,
        types: types,
        website: result.website,
      };
    } catch (error) {
      console.error(`Error normalizing place result: ${error.message}`);
      return null;
    }
  }

  /**
   * Normalize Google Places API details result
   * @param {Object} result - Google Places API details result
   * @returns {Object|null} - Normalized provider object
   */
  _normalizePlaceDetails(result) {
    try {
      const geometry = result.geometry || {};
      const location = geometry.location || {};

      // Extract city, state, country from address_components
      const addressComponents = result.address_components || [];
      let city = null;
      let state = null;
      let country = 'India';

      for (const component of addressComponents) {
        const types = component.types || [];
        if (types.includes('locality')) {
          city = component.long_name;
        } else if (types.includes('administrative_area_level_2')) {
          // Sometimes city is in administrative_area_level_2
          if (!city) {
            city = component.long_name;
          }
        } else if (types.includes('administrative_area_level_1')) {
          state = component.long_name;
        } else if (types.includes('country')) {
          country = component.long_name;
        }
      }

      // Fallback: Try to extract city from formatted_address if not found
      if (!city && result.formatted_address) {
        // Common pattern: "..., City, State, Country"
        const addressParts = result.formatted_address.split(',');
        if (addressParts.length >= 2) {
          // Usually city is second to last or third to last
          // Try to find a part that looks like a city name
          for (let i = addressParts.length - 3; i >= 0 && i >= addressParts.length - 5; i--) {
            const part = addressParts[i].trim();
            // Skip if it's a number or very short
            if (part.length > 2 && !/^\d+/.test(part)) {
              city = part;
              break;
            }
          }
        }
      }

      const types = result.types || [];
      let serviceType = null;
      
      // Try to find a meaningful service type
      const serviceTypeKeywords = ['plumber', 'electrician', 'carpenter', 'painter', 'mechanic', 'contractor', 'repair'];
      for (const t of types) {
        const typeLower = t.toLowerCase();
        // Check if type matches any service keyword
        for (const keyword of serviceTypeKeywords) {
          if (typeLower.includes(keyword)) {
            serviceType = keyword;
            break;
          }
        }
        if (serviceType) break;
      }
      
      // If no service type found, use first non-generic type
      if (!serviceType) {
        for (const t of types) {
          if (!['establishment', 'point_of_interest', 'store', 'premise', 'route', 'street_address'].includes(t)) {
            serviceType = t.replace(/_/g, ' ');
            break;
          }
        }
      }

      return {
        place_id: result.place_id,
        name: result.name,
        phone: result.formatted_phone_number || result.international_phone_number,
        address: result.formatted_address,
        city: city,
        state: state,
        country: country,
        latitude: location.lat,
        longitude: location.lng,
        rating: result.rating,
        review_count: result.user_ratings_total || 0,
        business_status: result.business_status || 'OPERATIONAL',
        price_level: result.price_level,
        service_type: serviceType,
        website: result.website,
        opening_hours: result.opening_hours || {},
        types: types,
      };
    } catch (error) {
      console.error(`Error normalizing place details: ${error.message}`);
      throw error; // Re-throw instead of returning null
    }
  }
}

export default GooglePlacesService;
