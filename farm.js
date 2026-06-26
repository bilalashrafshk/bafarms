/* ==========================================
   BA FARMS - INTERACTIVE LOGIC SUITE
   ========================================== */

const initApp = () => {

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
    // Run immediately on load so the correct link is underlined from the start
    updateActiveNavLink();


    // ----------------------------------------------------
    // 4. "PASTURE TO PORT" PIPELINE STEPPER CONTROLLER
    // ----------------------------------------------------
    const stepBtns = document.querySelectorAll('.step-btn');
    const stepPanes = document.querySelectorAll('.step-pane');

    stepBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const selectedStep = btn.getAttribute('data-step');

            // Deactivate all step nav buttons and activate the clicked one
            stepBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Deactivate all panes first, then activate target (force reflow for clean animation restart)
            stepPanes.forEach(pane => pane.classList.remove('active'));

            const targetPane = document.getElementById(`pane-step-${selectedStep}`);
            if (targetPane) {
                void targetPane.offsetWidth; // force reflow so CSS animation restarts cleanly
                targetPane.classList.add('active');
            }
        });
    });


    // ----------------------------------------------------
    // 5. QUALITY INTERACTIVE CHECKLIST DETAILED INSPECTOR
    // ----------------------------------------------------
    const tabBtns = document.querySelectorAll('.checklist-tabs .tab-btn');
    const itemsContainers = document.querySelectorAll('.checklist-items');
    const checkItems = document.querySelectorAll('.check-item');
    const detailsText = document.getElementById('details-text');
    const detailBox = document.getElementById('checklist-details');

    // Handle Tab Swapping
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');

            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            itemsContainers.forEach(container => {
                container.classList.remove('active');
                if (container.getAttribute('id') === `items-${targetTab}`) {
                    container.classList.add('active');
                }
            });

            // Reset selection highlights and details panel text
            checkItems.forEach(i => i.classList.remove('selected'));
            detailsText.textContent = 'Click any checklist item above to view our specific operational protocol details.';
            detailBox.style.borderLeftColor = 'var(--accent-gold)';
        });
    });

    // Handle Item Selection Click
    checkItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove previous selections from all items in this group
            checkItems.forEach(i => i.classList.remove('selected'));
            
            // Highlight clicked item
            item.classList.add('selected');

            // Fetch detail specification attribute
            const detailDescription = item.getAttribute('data-details');
            detailsText.innerHTML = `<strong>Protocol Standard:</strong> ${detailDescription}`;
            
            // Adjust border left to primary green to represent active check status
            detailBox.style.borderLeftColor = 'var(--primary-green-light)';
        });
    });


    // ----------------------------------------------------
    // 6. MINI FAQ ACCORDION HANDLERS
    // ----------------------------------------------------
    const faqTriggers = document.querySelectorAll('.faq-trigger');

    faqTriggers.forEach((trigger, idx) => {
        const faqItem = trigger.parentElement;
        const faqContent = faqItem.querySelector('.faq-content');
        const contentId = `faq-content-${idx}`;
        
        if (faqContent) {
            faqContent.setAttribute('id', contentId);
            trigger.setAttribute('aria-controls', contentId);
        }
        trigger.setAttribute('aria-expanded', 'false');

        trigger.addEventListener('click', () => {
            const isActive = faqItem.classList.contains('active');

            // Close all active faq items
            document.querySelectorAll('.faq-item').forEach(item => {
                item.classList.remove('active');
                const itemTrigger = item.querySelector('.faq-trigger');
                if (itemTrigger) {
                    itemTrigger.setAttribute('aria-expanded', 'false');
                }
            });

            // Toggle selected faq item
            if (!isActive) {
                faqItem.classList.add('active');
                trigger.setAttribute('aria-expanded', 'true');
            } else {
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
    });


    // ----------------------------------------------------
    // 7. B2B INQUIRY DESK HANDLERS & VALIDATION
    // ----------------------------------------------------
    const form = document.getElementById('inquiry-form');
    const inquiryTypeRadios = document.querySelectorAll('input[name="inquiry_type"]');
    const tabLabels = document.querySelectorAll('.form-tab-label');
    const portGroup = document.getElementById('port-destination-group');
    const inputPort = document.getElementById('input-port');
    const successOverlay = document.getElementById('form-success-overlay');
    const refIdSpan = document.getElementById('success-reference-id');
    const btnReset = document.getElementById('btn-success-reset');
    const submitBtn = document.getElementById('btn-submit-inquiry');

    // Swapping Form Mode Tabs (Global Export vs Domestic Supply)
    inquiryTypeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            // Adjust label visual active state
            tabLabels.forEach(lbl => lbl.classList.remove('active'));
            radio.parentElement.classList.add('active');

            // Handle conditional Destination Port display
            if (radio.value === 'Local') {
                portGroup.style.display = 'none';
                inputPort.removeAttribute('required');
                inputPort.value = '';
                // Clear validation marks on port if closed
                const portParent = inputPort.parentElement;
                portParent.classList.remove('invalid', 'valid');
            } else {
                portGroup.style.display = 'block';
                inputPort.setAttribute('required', 'required');
            }
        });
    });

    // Individual Input Elements for real-time listener binding
    const fields = {
        name: { element: document.getElementById('input-name'), msg: document.getElementById('msg-name') },
        company: { element: document.getElementById('input-company'), msg: document.getElementById('msg-company') },
        email: { element: document.getElementById('input-email'), msg: document.getElementById('msg-email') },
        phone: { element: document.getElementById('input-phone'), msg: document.getElementById('msg-phone') },
        beef: { element: document.getElementById('select-beef'), msg: document.getElementById('msg-beef') },
        port: { element: document.getElementById('input-port'), msg: document.getElementById('msg-port') }
    };

    // Helper: Mark validation status
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

    // Email checker including public email warning
    function validateEmail(emailVal) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailVal) return { valid: false, text: 'Corporate email is required.' };
        if (!emailRegex.test(emailVal)) return { valid: false, text: 'Please enter a valid email structure.' };

        // B2B premium business alert checking
        const publicDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'mail.ru'];
        const domain = emailVal.split('@')[1]?.toLowerCase();
        if (publicDomains.includes(domain)) {
            return { valid: true, warning: true, text: 'Note: Business corporate domain recommended.' };
        }
        return { valid: true };
    }

    // Phone checker
    function validatePhone(phoneVal) {
        const phoneRegex = /^\+?[0-9\s\-()]{7,20}$/;
        if (!phoneVal) return { valid: false, text: 'Phone number is required.' };
        if (!phoneRegex.test(phoneVal)) return { valid: false, text: 'Please enter a valid corporate contact number.' };
        return { valid: true };
    }

    // Validation runner for single field
    function validateField(fieldName) {
        const field = fields[fieldName];
        const val = field.element.value.trim();

        // If field is destination port and is currently hidden/not required, skip validation
        if (fieldName === 'port' && document.querySelector('input[name="inquiry_type"]:checked').value === 'Local') {
            return true;
        }

        if (fieldName === 'name') {
            if (!val) {
                setValidity(field, false, 'Contact name is required.');
                return false;
            }
            if (val.length < 3) {
                setValidity(field, false, 'Name must be at least 3 characters.');
                return false;
            }
            setValidity(field, true);
            return true;
        }

        if (fieldName === 'company') {
            if (!val) {
                setValidity(field, false, 'Company name is required.');
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
            // If it is a public domain but mathematically valid, show warning color
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

        if (fieldName === 'beef') {
            if (!val) {
                setValidity(field, false, 'Please select your cattle/cut requirements.');
                return false;
            }
            setValidity(field, true);
            return true;
        }

        if (fieldName === 'port') {
            if (!val) {
                setValidity(field, false, 'Destination delivery port is required for exports.');
                return false;
            }
            setValidity(field, true);
            return true;
        }

        return true;
    }

    // Attach dynamic validation event listeners on blur/input
    Object.keys(fields).forEach(key => {
        fields[key].element.addEventListener('blur', () => validateField(key));
        fields[key].element.addEventListener('input', () => {
            const parent = fields[key].element.parentElement;
            if (parent.classList.contains('invalid')) {
                validateField(key);
            }
        });
    });

    // Form submission simulation
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        // Run validation across all fields
        let isFormValid = true;
        Object.keys(fields).forEach(key => {
            const valid = validateField(key);
            if (!valid) isFormValid = false;
        });

        if (!isFormValid) {
            // Scroll to the first validation error
            const firstInvalid = document.querySelector('.form-group.invalid');
            if (firstInvalid) {
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        // Set form button loading state
        submitBtn.classList.add('submitting');
        submitBtn.setAttribute('disabled', 'disabled');

        // Simulate modern API network round-trip of 1.5s
        setTimeout(() => {
            submitBtn.classList.remove('submitting');
            submitBtn.removeAttribute('disabled');

            // Generate unique corporate B2B inquiry reference code
            const isExport = document.querySelector('input[name="inquiry_type"]:checked').value === 'Export';
            const prefix = isExport ? 'BA-EX' : 'BA-DOM';
            const randomCode = Math.floor(10000 + Math.random() * 90000);
            
            refIdSpan.textContent = `${prefix}-${randomCode}`;
            successOverlay.classList.add('active');
            
            // Scroll success view into focus
            successOverlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 1500);
    });

    // Reset Form button action from success state
    btnReset.addEventListener('click', () => {
        form.reset();
        
        // Remove validation highlight indicators
        Object.keys(fields).forEach(key => {
            const parent = fields[key].element.parentElement;
            parent.classList.remove('valid', 'invalid');
            fields[key].msg.style.display = 'none';
        });

        // Hide success overlay screen
        successOverlay.classList.remove('active');
        
        // Reset destination port field visibility to default (Export checked)
        portGroup.style.display = 'block';
        inputPort.setAttribute('required', 'required');
        
        // Reset active radio tabs state
        tabLabels.forEach(lbl => lbl.classList.remove('active'));
        document.getElementById('tab-label-export').classList.add('active');
    });

};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
