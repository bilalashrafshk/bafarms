/* ==========================================
   BA FOODS - CORPORATE B2B PORTAL INTERACTION
   ========================================== */

const initApp = () => {

    // Auto-scroll to enquiry form if loaded via deep links
    if (window.location.pathname === '/enquiry' || window.location.hash === '#enquiry') {
        setTimeout(() => {
            const enquirySec = document.getElementById('enquiry');
            if (enquirySec) {
                enquirySec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 400);
    }

    // ----------------------------------------------------
    // 1. HEADER SCROLL DETECTOR
    // ----------------------------------------------------
    const header = document.getElementById('header');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });

    // ----------------------------------------------------
    // 2. MOBILE MENU NAVIGATION TOGGLE
    // ----------------------------------------------------
    const menuToggle = document.getElementById('menu-toggle');
    const navMenu = document.getElementById('nav-menu');
    const menuIcon = menuToggle.querySelector('i');

    menuToggle.addEventListener('click', () => {
        navMenu.classList.toggle('mobile-active');
        if (navMenu.classList.contains('mobile-active')) {
            menuIcon.className = 'fa-solid fa-xmark';
            document.body.style.overflow = 'hidden'; // lock background scrolling
        } else {
            menuIcon.className = 'fa-solid fa-bars';
            document.body.style.overflow = ''; // restore scrolling
        }
    });

    // Close mobile menu on clicking any navigation link
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('mobile-active');
            menuIcon.className = 'fa-solid fa-bars';
            document.body.style.overflow = ''; // restore scrolling
        });
    });

    // ----------------------------------------------------
    // 3. SCROLL-SPY ACTIVE NAVIGATION LINK HIGHLIGHTS
    // ----------------------------------------------------
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');

    function updateActiveNavLink() {
        let currentSectionId = '';
        const scrollPosition = window.scrollY + 120; // offset for nav header height

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                currentSectionId = section.getAttribute('id');
            }
        });

        // Fall back to first section when at very top
        if (!currentSectionId && window.scrollY < 100) {
            currentSectionId = sections[0] ? sections[0].getAttribute('id') : '';
        }

        if (currentSectionId) {
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('data-sec') === currentSectionId) {
                    link.classList.add('active');
                }
            });
        }
    }

    window.addEventListener('scroll', updateActiveNavLink);
    updateActiveNavLink();

    // ----------------------------------------------------
    // 4. DYNAMIC PRODUCTS SPECS & DROPDOWN POPULATOR
    // ----------------------------------------------------
    const tableBody = document.getElementById('cuts-table-body');
    const cutSelect = document.getElementById('select-cut');

    // Helper: Map cut characteristics dynamically
    function getPrimalSource(title, marbling) {
        const t = title.toLowerCase();
        if (t.includes('chilled') && (t.includes('carcass') || t.includes('quarter'))) return 'Halal slaughtered chilled carcass / quarters';
        if (t.includes('frozen') && (t.includes('carcass') || t.includes('quarter'))) return 'Halal slaughtered frozen carcass / quarters';
        if (t.includes('chilled') && t.includes('primal')) return 'Sahiwal x Friesian (Grain-Finished)';
        if (t.includes('frozen') && t.includes('primal')) return 'Custom specifications on request';
        if (t.includes('offal')) return 'Export-grade beef offal & constituents';

        if (t.includes('ribeye')) return 'Primal Short Loin (Rib)';
        if (t.includes('t-bone') || t.includes('tbone')) return 'Short Loin / T-Bone';
        if (t.includes('striploin')) return 'Primal Loin (Striploin)';
        if (t.includes('mince') || t.includes('ground')) return 'Chuck & Round Primal';
        if (t.includes('shank') || t.includes('bong')) return 'Beef Shank (Bone-in)';
        if (t.includes('burger') || t.includes('patty') || t.includes('patties')) return 'Chuck & Brisket Blend';
        return marbling || 'Premium Loin Primal';
    }

    function getPackagingType(title, fatRatio) {
        const t = title.toLowerCase();
        if (t.includes('chilled') && (t.includes('carcass') || t.includes('quarter'))) return 'High-barrier vacuum packed (UAE/GCC compliant)';
        if (t.includes('frozen') && (t.includes('carcass') || t.includes('quarter'))) return 'Stockinette wrapped / custom wrapping';
        if (t.includes('chilled') && t.includes('primal')) return 'Vacuum packed; carton weights to spec';
        if (t.includes('frozen') && t.includes('primal')) return 'Vacuum packed in heavy shipping cartons';
        if (t.includes('offal')) return 'Vacuum packed / poly cartons';

        if (t.includes('mince') || t.includes('burger') || t.includes('patty') || t.includes('patties')) {
            return 'Modified Atmosphere (MAP)';
        }
        return 'High-Barrier Vacuum Skin (VSP)';
    }

    function getShelfLife(title) {
        const t = title.toLowerCase();
        if (t.includes('chilled')) return '60–90 Days Chilled (0-2°C)';
        if (t.includes('frozen')) return 'Up to 12 Months (Frozen at -18°C)';
        if (t.includes('offal')) return 'Up to 12 Months (Frozen at -18°C)';

        if (t.includes('burger') || t.includes('patty') || t.includes('patties')) {
            return '12 Months (Frozen)';
        }
        if (t.includes('mince') || t.includes('ground')) {
            return '21 Days Chilled (0-2°C)';
        }
        return '90 Days Chilled (0-2°C)';
    }

    function getAvailableVolume(title) {
        const t = title.toLowerCase();
        if (t.includes('chilled') && t.includes('primal')) return '1–2 tons/week Air Freight, scaling with demand';
        if (t.includes('chilled') && (t.includes('carcass') || t.includes('quarter'))) return 'Air Freight, scaling with demand';
        if (t.includes('frozen') && (t.includes('carcass') || t.includes('quarter'))) return 'Container reefers / Sea Freight';
        if (t.includes('frozen') && t.includes('primal')) return 'Container reefers / Sea Freight';
        if (t.includes('offal')) return 'Dispatched to high-value international markets';

        if (t.includes('ribeye')) return '15 MT / Month';
        if (t.includes('t-bone') || t.includes('tbone')) return '12 MT / Month';
        if (t.includes('striploin')) return '10 MT / Month';
        if (t.includes('mince')) return '25 MT / Month';
        if (t.includes('shank') || t.includes('bong')) return '30 MT / Month';
        return '20 MT / Month';
    }
    function populateCuts(cuts) {
        // Clear loading state
        tableBody.innerHTML = '';
        
        // Clear selection dropdown but keep default disabled option
        if (cutSelect) {
            cutSelect.innerHTML = '<option value="" disabled selected>Select meat product requirement...</option>';
        }

        cuts.forEach(cut => {
            // Populate Table Row
            const row = document.createElement('tr');
            
            const primal = cut.spec || getPrimalSource(cut.title, cut.marbling);
            const packaging = cut.packaging || getPackagingType(cut.title, cut.fat_ratio);
            const shelf = cut.shelf_life || getShelfLife(cut.title);
            const volume = cut.capacity || getAvailableVolume(cut.title);
            
            row.innerHTML = `
                <td><strong>${cut.title}</strong></td>
                <td><span class="spec-tag spec-tag-steel">${primal}</span></td>
                <td>${packaging}</td>
                <td><span class="spec-tag spec-tag-green">${shelf}</span></td>
                <td>${cut.weight || 'Carton weights to buyer spec'}</td>
                <td><span class="spec-tag spec-tag-gold">${volume}</span></td>
            `;
            tableBody.appendChild(row);

            // Populate Dropdown Selection Option
            if (cutSelect) {
                const option = document.createElement('option');
                option.value = cut.title;
                option.textContent = `${cut.title} (${cut.weight || 'Custom Spec'})`;
                cutSelect.appendChild(option);
            }
        });

        // Add an option for bulk container/primal sides
        if (cutSelect) {
            const generalOption = document.createElement('option');
            generalOption.value = "Custom / Primal Sides";
            generalOption.textContent = "Custom Primal Cuts / Whole Carcass sides";
            cutSelect.appendChild(generalOption);
        }
    }

    // Fallback static B2B export specifications (loaded immediately for progressive rendering)
    const defaultCuts = [
        {
            id: 'chilled_carcasses_quarters',
            title: 'Chilled Carcasses & Quarters',
            spec: 'Halal slaughtered chilled carcasses/quarters (4-quarters cut)',
            packaging: 'High-barrier vacuum packed (UAE/GCC compliant)',
            shelf_life: '60–90 Days Chilled (0-2°C)',
            weight: '30-45 kg quarter / 120-180 kg carcass',
            capacity: 'Air freighted, scaling with demand'
        },
        {
            id: 'chilled_primal_cuts',
            title: 'Chilled Beef Primal Cuts',
            spec: 'Sahiwal x Friesian (Grain-Finished)',
            packaging: 'Vacuum packed; carton weights to buyer spec',
            shelf_life: '60–90 Days Chilled (0-2°C)',
            weight: 'Carton weights to buyer spec',
            capacity: 'from 1–2 tons/week, scaling with demand'
        },
        {
            id: 'frozen_carcasses_quarters',
            title: 'Frozen Carcasses & Quarters',
            spec: 'Halal slaughtered frozen carcasses/quarters',
            packaging: 'Stockinette wrapped / custom wrapping',
            shelf_life: 'Up to 12 Months (Frozen at -18°C)',
            weight: '30-45 kg quarter / 120-180 kg carcass',
            capacity: 'Sea freight container reefers where volume justifies'
        },
        {
            id: 'frozen_primal_cuts',
            title: 'Frozen Primal Cuts',
            spec: 'Custom specifications on request',
            packaging: 'Vacuum packed in heavy shipping cartons',
            shelf_life: 'Up to 12 Months (Frozen at -18°C)',
            weight: 'Carton weights to buyer spec',
            capacity: 'Sea freight container reefers where volume justifies'
        },
        {
            id: 'beef_offal',
            title: 'Beef Offal & Variety Meats',
            spec: 'Export-grade beef offal & constituents',
            packaging: 'Vacuum packed / poly cartons',
            shelf_life: 'Up to 12 Months (Frozen at -18°C)',
            weight: 'Carton weights to buyer spec',
            capacity: 'Dispatched to high-value international markets'
        }
    ];

    // Populate table instantly for progressive rendering, avoiding any loading blank state
    populateCuts(defaultCuts);

    const loadExportCuts = async () => {
        try {
            const response = await fetch('/api/enquiry');
            const contentType = response.headers.get('content-type');
            if (!response.ok || (contentType && contentType.includes('text/html'))) {
                throw new Error('API server returned invalid response');
            }
            const data = await response.json();

            if (data.success && data.cuts) {
                // Background refresh only if API resolves successfully
                populateCuts(data.cuts);
            }
        } catch (e) {
            console.warn('API fetch bypassed, utilizing static B2B specifications:', e);
        }
    };

    loadExportCuts();

    // ----------------------------------------------------
    // 5. B2B ENQUIRY FORM VALIDATION & DB SUBMIT
    // ----------------------------------------------------
    const form = document.getElementById('export-enquiry-form');
    const successOverlay = document.getElementById('form-success-overlay');
    const refIdSpan = document.getElementById('success-reference-id');
    const btnReset = document.getElementById('btn-success-reset');
    const submitBtn = document.getElementById('btn-submit-enquiry');

    const fields = {
        company: { element: document.getElementById('input-company'), msg: document.getElementById('msg-company') },
        contact: { element: document.getElementById('input-contact'), msg: document.getElementById('msg-contact') },
        email: { element: document.getElementById('input-email'), msg: document.getElementById('msg-email') },
        phone: { element: document.getElementById('input-phone'), msg: document.getElementById('msg-phone') },
        notes: { element: document.getElementById('textarea-notes'), msg: document.getElementById('msg-notes') }
    };

    function setValidity(fieldObj, isValid, errorText = '') {
        const parent = fieldObj.element.parentElement;
        if (isValid) {
            parent.classList.remove('invalid');
            parent.classList.add('valid');
            fieldObj.msg.style.display = 'none';
        } else {
            parent.classList.remove('valid');
            parent.classList.add('invalid');
            fieldObj.msg.textContent = errorText;
            fieldObj.msg.style.display = 'block';
        }
    }

    function validateEmail(emailVal) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailVal) return { valid: false, text: 'Corporate email is required.' };
        if (!emailRegex.test(emailVal)) return { valid: false, text: 'Please enter a valid email structure.' };

        // Corporate warning check
        const publicDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'mail.ru'];
        const domain = emailVal.split('@')[1]?.toLowerCase();
        if (publicDomains.includes(domain)) {
            return { valid: true, warning: true, text: 'Note: Corporate domain recommended for institutional exports.' };
        }
        return { valid: true };
    }

    function validatePhone(phoneVal) {
        const phoneRegex = /^\+?[0-9\s\-()]{7,20}$/;
        if (!phoneVal) return { valid: false, text: 'Phone number is required.' };
        if (!phoneRegex.test(phoneVal)) return { valid: false, text: 'Please enter a valid corporate contact number.' };
        return { valid: true };
    }

    function validateField(fieldName) {
        const field = fields[fieldName];
        const val = field.element.value.trim();

        if (fieldName === 'company') {
            if (!val) {
                setValidity(field, false, 'Company name is required.');
                return false;
            }
            if (val.length < 3) {
                setValidity(field, false, 'Company name must be at least 3 characters.');
                return false;
            }
            setValidity(field, true);
            return true;
        }

        if (fieldName === 'contact') {
            if (!val) {
                setValidity(field, false, 'Contact person name is required.');
                return false;
            }
            if (val.length < 3) {
                setValidity(field, false, 'Contact name must be at least 3 characters.');
                return false;
            }
            setValidity(field, true);
            return true;
        }

        if (fieldName === 'email') {
            const res = validateEmail(val);
            if (!res.valid) {
                setValidity(field, false, res.text);
                return false;
            }
            if (res.warning) {
                setValidity(field, true);
                const parent = field.element.parentElement;
                parent.classList.add('valid');
                field.msg.textContent = res.text;
                field.msg.style.color = 'var(--accent-gold)';
                field.msg.style.display = 'block';
            } else {
                setValidity(field, true);
            }
            return true;
        }

        if (fieldName === 'phone') {
            const res = validatePhone(val);
            if (!res.valid) {
                setValidity(field, false, res.text);
                return false;
            }
            setValidity(field, true);
            return true;
        }

        if (fieldName === 'notes') {
            if (!val) {
                setValidity(field, false, 'Please specify your requirements or enquiry details.');
                return false;
            }
            if (val.length < 10) {
                setValidity(field, false, 'Please describe your requirements in more detail (at least 10 characters).');
                return false;
            }
            setValidity(field, true);
            return true;
        }

        return true;
    }

    // Attach dynamic validation events
    Object.keys(fields).forEach(key => {
        fields[key].element.addEventListener('blur', () => validateField(key));
        fields[key].element.addEventListener('input', () => {
            const parent = fields[key].element.parentElement;
            if (parent.classList.contains('invalid')) {
                validateField(key);
            }
        });
    });

    // Form Submit Handler
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Run validation across all fields
        let isFormValid = true;
        Object.keys(fields).forEach(key => {
            const valid = validateField(key);
            if (!valid) isFormValid = false;
        });

        if (!isFormValid) {
            const firstInvalid = document.querySelector('.form-group.invalid');
            if (firstInvalid) {
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        // Set form loading state
        submitBtn.setAttribute('disabled', 'disabled');
        submitBtn.querySelector('span').textContent = 'Lodging B2B Enquiry...';

        const payload = {
            company: fields.company.element.value.trim(),
            contact: fields.contact.element.value.trim(),
            email: fields.email.element.value.trim(),
            phone: fields.phone.element.value.trim(),
            country: 'Not Specified',
            cut_type: 'General Inquiry',
            volume_mt: 0,
            frequency: 'One-time',
            notes: fields.notes.element.value.trim()
        };

        try {
            const response = await fetch('/api/enquiry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (data.success && data.id) {
                refIdSpan.textContent = data.id;
                successOverlay.style.display = 'flex';
                successOverlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                throw new Error(data.error || 'Failed to submit B2B enquiry');
            }

        } catch (err) {
            console.error('Form submission failed:', err);
            alert(`Submission Error: ${err.message}. Please try again later.`);
        } finally {
            submitBtn.removeAttribute('disabled');
            submitBtn.querySelector('span').textContent = 'Submit Export Enquiry';
        }
    });

    // Reset Form Success View
    btnReset.addEventListener('click', () => {
        form.reset();
        
        // Remove validation classes
        Object.keys(fields).forEach(key => {
            const parent = fields[key].element.parentElement;
            parent.classList.remove('valid', 'invalid');
            fields[key].msg.style.display = 'none';
        });

        successOverlay.style.display = 'none';
        document.getElementById('enquiry').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
