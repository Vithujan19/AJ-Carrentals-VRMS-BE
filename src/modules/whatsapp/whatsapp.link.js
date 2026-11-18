const COLOMBO = 'Asia/Colombo';

export function normalizeWhatsAppNumber(value, defaultCountryCode = '94') {
  if (typeof value !== 'string') return null;
  let digits = value.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = `${defaultCountryCode}${digits.slice(1)}`;
  }
  digits = digits.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function formatColombo(value) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: COLOMBO,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function bookingRequestMessage({ businessName, reference, vehicleName, pickupAt, returnAt, customerName }) {
  return [
    `Hello ${businessName}, I would like to confirm my booking request.`,
    `Reference: ${reference}`,
    `Vehicle: ${vehicleName}`,
    `Pickup: ${formatColombo(pickupAt)} (Sri Lanka time)`,
    `Return: ${formatColombo(returnAt)} (Sri Lanka time)`,
    `Name: ${customerName}`,
  ].join('\n');
}

export function clickToChatUrl(number, text) {
  if (!number) return null;
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function vehicleLabel(specification) {
  return [specification?.make, specification?.model, specification?.variant].filter(Boolean).join(' ') || 'Vehicle';
}
