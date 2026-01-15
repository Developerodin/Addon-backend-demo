/**
 * Call templates for different service types.
 * These templates provide structured data that can be used by Bolna AI agents
 * to customize the call script/prompt based on the service type.
 */

const TEMPLATES = {
  electrician: {
    template_name: 'electrician',
    introduction: "Hello, my name is {ai_agent_name} and I'm an AI assistant calling on behalf of a service platform.",
    business_verification: 'Am I speaking with {provider_name}?',
    location_confirmation: "I'm calling on behalf of a customer who needs {service_type} services. I see your business is located at {location}. Is that correct?",
    purpose: "I'm calling to inquire about your electrical services and availability",
    key_points: [
      'Type of electrical services offered',
      'Availability and response time',
      'Service area coverage',
      'Pricing structure',
      'Emergency services availability'
    ],
    closing: 'Thank you for your time. We may contact you if we have a client needing electrical services.',
  },
  plumber: {
    template_name: 'plumber',
    introduction: "Hello, my name is {ai_agent_name} and I'm an AI assistant calling on behalf of a service platform.",
    business_verification: 'Am I speaking with {provider_name}?',
    location_confirmation: "I'm calling on behalf of a customer who needs {service_type} services. I see your business is located at {location}. Is that correct?",
    purpose: "I'm calling to inquire about your plumbing services and availability",
    key_points: [
      'Type of plumbing services offered',
      'Availability and response time',
      'Service area coverage',
      'Pricing structure',
      'Emergency services availability'
    ],
    closing: 'Thank you for your time. We may contact you if we have a client needing plumbing services.',
  },
  carpenter: {
    template_name: 'carpenter',
    introduction: "Hello, my name is {ai_agent_name} and I'm an AI assistant calling on behalf of a service platform.",
    business_verification: 'Am I speaking with {provider_name}?',
    location_confirmation: "I'm calling on behalf of a customer who needs {service_type} services. I see your business is located at {location}. Is that correct?",
    purpose: "I'm calling to inquire about your carpentry services and availability",
    key_points: [
      'Type of carpentry services offered',
      'Availability and response time',
      'Service area coverage',
      'Pricing structure',
      'Custom work capabilities'
    ],
    closing: 'Thank you for your time. We may contact you if we have a client needing carpentry services.',
  },
  mechanic: {
    template_name: 'mechanic',
    introduction: "Hello, my name is {ai_agent_name} and I'm an AI assistant calling on behalf of a service platform.",
    business_verification: 'Am I speaking with {provider_name}?',
    location_confirmation: "I'm calling on behalf of a customer who needs {service_type} services. I see your business is located at {location}. Is that correct?",
    purpose: "I'm calling to inquire about your mechanic services and availability",
    key_points: [
      'Type of vehicle repairs offered',
      'Availability and response time',
      'Service area coverage',
      'Pricing structure',
      'Warranty on repairs'
    ],
    closing: 'Thank you for your time. We may contact you if we have a client needing mechanic services.',
  },
  painter: {
    template_name: 'painter',
    introduction: "Hello, my name is {ai_agent_name} and I'm an AI assistant calling on behalf of a service platform.",
    business_verification: 'Am I speaking with {provider_name}?',
    location_confirmation: "I'm calling on behalf of a customer who needs {service_type} services. I see your business is located at {location}. Is that correct?",
    purpose: "I'm calling to inquire about your painting services and availability",
    key_points: [
      'Type of painting services offered (interior/exterior)',
      'Availability and response time',
      'Service area coverage',
      'Pricing structure',
      'Material sourcing options'
    ],
    closing: 'Thank you for your time. We may contact you if we have a client needing painting services.',
  },
};

const DEFAULT_TEMPLATE = {
  template_name: 'general',
  introduction: "Hello, my name is {ai_agent_name} and I'm an AI assistant calling on behalf of a service platform.",
  business_verification: 'Am I speaking with {provider_name}?',
  location_confirmation: "I'm calling on behalf of a customer who needs {service_type} services. I see your business is located at {location}. Is that correct?",
  purpose: "I'm calling to inquire about your services and availability",
  key_points: [
    'Services offered',
    'Availability and response time',
    'Service area coverage',
    'Pricing structure'
  ],
  closing: 'Thank you for your time. We may contact you if we have a client needing your services.',
};

/**
 * Get call template for a specific service type
 * @param {string} serviceType - The service type (e.g., 'electrician', 'plumber')
 * @returns {Object} Template data for the service type
 */
export const getTemplate = (serviceType) => {
  if (!serviceType) {
    return { ...DEFAULT_TEMPLATE };
  }

  // Normalize service type to lowercase
  const normalized = serviceType.toLowerCase().trim();

  // Return template if exists, otherwise return default
  return TEMPLATES[normalized] ? { ...TEMPLATES[normalized] } : { ...DEFAULT_TEMPLATE };
};

/**
 * Get complete template data with all variables filled in
 * @param {string} serviceType - The service type (e.g., 'electrician', 'plumber')
 * @param {string} providerName - Name of the service provider
 * @param {string} location - Location/service area
 * @param {string} language - Language code ('en' or 'hi')
 * @returns {Object} Complete template data to be used in user_data
 */
export const getTemplateData = (serviceType, providerName, location, language) => {
  const template = getTemplate(serviceType);

  // AI agent name based on language: Amritanshu for English, Alok for Hindi
  const aiAgentName = language === 'hi' ? 'Alok' : 'Amritanshu';

  // Format template strings with variables
  const introduction = template.introduction.replace('{ai_agent_name}', aiAgentName);
  const businessVerification = template.business_verification.replace('{provider_name}', providerName);
  const locationConfirmation = template.location_confirmation.replace('{location}', location);

  return {
    template_name: template.template_name,
    provider_name: providerName,
    service_type: serviceType,
    location: location,
    language: language,
    ai_agent_name: aiAgentName,
    introduction: introduction,
    business_verification: businessVerification,
    location_confirmation: locationConfirmation,
    purpose: template.purpose,
    key_points: template.key_points,
    closing: template.closing,
  };
};

/**
 * Get list of all supported service types with templates
 * @returns {string[]} List of service type strings
 */
export const listServiceTypes = () => {
  return Object.keys(TEMPLATES);
};
