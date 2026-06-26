/* ==========================================
   BA FARMS B2C PRODUCT PAGE MODULE
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
    const prodId = new URLSearchParams(window.location.search).get('id');
    
    // Check if products have finished seeding/loading in window from shop.js
    const checkProductsLoaded = setInterval(() => {
        if (window.PRODUCTS && window.PRODUCTS.length > 0) {
            clearInterval(checkProductsLoaded);
            loadProductDetails(prodId);
        }
    }, 50);

    // Timeout fallback after 3 seconds
    setTimeout(() => {
        clearInterval(checkProductsLoaded);
        if (!window.PRODUCTS || window.PRODUCTS.length === 0) {
            loadProductDetails(prodId);
        }
    }, 3000);
});

const loadProductDetails = (prodId) => {
    const products = window.PRODUCTS || [];
    const product = products.find(p => p.id === prodId?.toLowerCase());
    
    const loadingEl = document.getElementById('product-loading-content');
    const pageEl = document.getElementById('product-page-content');
    const errorEl = document.getElementById('product-error-content');
    const errorProdIdEl = document.getElementById('error-product-id');

    if (loadingEl) loadingEl.style.display = 'none';
    
    if (!product) {
        if (pageEl) pageEl.style.display = 'none';
        if (errorEl) errorEl.style.display = 'flex';
        if (errorProdIdEl) errorProdIdEl.textContent = prodId || 'unknown';
        return;
    }

    if (pageEl) pageEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';

    // --- Dynamic SEO Meta Tags Overrides ---
    document.title = `${product.title} | BA Farms Gourmet & Qurbani`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', product.desc);

    // Open Graph for social platforms
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const ogImg = document.querySelector('meta[property="og:image"]');
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogTitle) ogTitle.setAttribute('content', product.title);
    if (ogDesc) ogDesc.setAttribute('content', product.desc);
    if (ogImg) ogImg.setAttribute('content', window.location.origin + '/' + product.image);
    if (ogUrl) ogUrl.setAttribute('content', window.location.href);

    // JSON-LD Product Schema for search engine indexing
    const schemaScript = document.getElementById('schema-product-metadata');
    if (schemaScript) {
        const schema = {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": product.title,
            "image": product.images ? product.images.map(img => window.location.origin + '/' + img) : [window.location.origin + '/' + product.image],
            "description": product.desc,
            "sku": product.rfid,
            "brand": {
                "@type": "Brand",
                "name": "BA Farms"
            },
            "offers": {
                "@type": "Offer",
                "priceCurrency": "PKR",
                "price": product.price,
                "itemCondition": "https://schema.org/NewCondition",
                "availability": "https://schema.org/InStock",
                "url": window.location.href
            }
        };
        schemaScript.textContent = JSON.stringify(schema, null, 2);
    }

    // --- Render Catalog Specs ---
    document.getElementById('product-name').textContent = product.title;
    document.getElementById('product-description').textContent = product.desc;
    
    const isLive = product.category === 'live';
    const catBadge = document.getElementById('product-category-badge');
    catBadge.textContent = isLive ? 'Live Qurbani Booking' : 'Gourmet Cold Cut';
    catBadge.style.background = isLive ? 'rgba(212, 163, 89, 0.15)' : 'rgba(25, 135, 84, 0.15)';
    catBadge.style.color = isLive ? 'var(--accent-gold)' : 'var(--primary-green-light)';
    catBadge.style.borderColor = isLive ? 'var(--accent-gold)' : 'var(--primary-green-light)';

    const ribbon = document.getElementById('product-ribbon-tag');
    ribbon.textContent = product.ribbon;
    ribbon.style.background = isLive ? 'var(--accent-gold)' : 'var(--primary-green-light)';

    document.getElementById('product-price-val').textContent = `PKR ${product.price.toLocaleString()}`;
    document.getElementById('product-weight-val').textContent = product.weight;
    
    document.getElementById('icon-meta-weight').className = isLive ? 'fa-solid fa-weight-scale' : 'fa-solid fa-weight-hanging';
    document.getElementById('icon-meta-spec').className = isLive ? 'fa-solid fa-tooth' : 'fa-solid fa-dna';
    document.getElementById('product-spec-val').textContent = product.marbling;
    document.getElementById('product-status-val').textContent = isLive ? 'Bio-Safety Cleared' : 'Cold-Chain Certified';

    // --- Rearing / Processing RFID Passport Details ---
    const passport = window.RFID_DATABASE[product.rfid];
    if (passport) {
        document.getElementById('pass-tag-id').textContent = passport.tagId;
        document.getElementById('pass-breed').textContent = passport.breed;
        document.getElementById('pass-age').textContent = passport.age;
        document.getElementById('pass-division').textContent = passport.division;
        document.getElementById('pass-nutrition').textContent = passport.nutrition;
        document.getElementById('pass-vacc').textContent = passport.vaccinations;
        document.getElementById('pass-temp').textContent = passport.tempCurve;
        
        const labelTag = document.getElementById('pass-label-tag');
        const valTag = document.getElementById('pass-tag-id');

        if (isLive) {
            if (labelTag) labelTag.style.display = 'block';
            if (valTag) valTag.style.display = 'block';
            document.getElementById('passport-header-title').textContent = "RFID Tag Passport Details";
            document.getElementById('pass-label-breed').textContent = "Breed Registry:";
            document.getElementById('pass-label-age').textContent = "Age Compliance:";
            document.getElementById('pass-label-division').textContent = "Division Pen:";
            document.getElementById('pass-label-nutrition').textContent = "Nutrition Feed:";
            document.getElementById('pass-label-vacc').textContent = "Safety Check:";
            document.getElementById('pass-label-temp').textContent = "Bio-security Level:";
        } else {
            if (labelTag) labelTag.style.display = 'none';
            if (valTag) valTag.style.display = 'none';
            document.getElementById('passport-header-title').textContent = "Partner Processing & Quality Logs";
            document.getElementById('pass-label-breed').textContent = "Source Origin:";
            document.getElementById('pass-label-age').textContent = "Aging Period:";
            document.getElementById('pass-label-division').textContent = "Partner Facility:";
            document.getElementById('pass-label-nutrition').textContent = "Diet Reference:";
            document.getElementById('pass-label-vacc').textContent = "Slaughter Protocol:";
            document.getElementById('pass-label-temp').textContent = "Chilled Temp Log:";
        }
    }

    // --- Interactive Multi-Image Gallery Carousel ---
    const mainImg = document.getElementById('product-main-image');
    const thumbStrip = document.getElementById('product-thumbnails-strip');
    thumbStrip.innerHTML = '';
    
    const imagesList = product.images || [product.image];
    mainImg.src = imagesList[0];
    mainImg.alt = product.title;

    imagesList.forEach((imgUrl, idx) => {
        const btn = document.createElement('button');
        btn.className = `thumb-btn ${idx === 0 ? 'active' : ''}`;
        btn.id = `thumbnail-${idx}`;
        btn.innerHTML = `<img src="${imgUrl}" alt="${product.title} view ${idx + 1}">`;
        
        btn.addEventListener('click', () => {
            document.querySelectorAll('.thumb-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            mainImg.style.opacity = '0';
            setTimeout(() => {
                mainImg.onerror = () => { mainImg.style.display = 'none'; };
                mainImg.src = imgUrl;
                mainImg.style.opacity = '1';
            }, 150);
        });
        thumbStrip.appendChild(btn);
    });

    // --- Price Calculator & Dynamic Shipping ---
    const citySelect = document.getElementById('detail-city-select');
    const calcSub = document.getElementById('calc-subtotal');
    const calcShip = document.getElementById('calc-shipping');
    const calcDepRow = document.getElementById('calc-deposit-row');
    const calcDep = document.getElementById('calc-deposit');
    const calcTotal = document.getElementById('calc-total');

    const updateCalculatedPrice = () => {
        const city = citySelect.value;
        if (window.selectedCity !== city) {
            window.selectedCity = city; // sync state inside shop.js
        }
        
        let shipping = 350;
        if (isLive) {
            shipping = 5000;
            if (city === 'Faisalabad') shipping = 0;
            else if (city === 'Karachi') shipping = 12000;
        } else {
            if (city === 'Faisalabad') shipping = 0;
        }

        const subtotal = product.price;
        const total = subtotal + shipping;
        const deposit = Math.round(total * 0.5);

        calcSub.textContent = `PKR ${subtotal.toLocaleString()}`;
        calcShip.textContent = `PKR ${shipping.toLocaleString()}`;
        calcTotal.textContent = `PKR ${total.toLocaleString()}`;

        if (isLive) {
            calcDep.textContent = `PKR ${deposit.toLocaleString()}`;
            calcDepRow.style.display = 'flex';
            document.getElementById('booking-or-direct-label').textContent = "Booking Deposit (50%):";
        } else {
            calcDepRow.style.display = 'none';
            document.getElementById('booking-or-direct-label').textContent = "Direct Price Value:";
        }
    };

    citySelect.addEventListener('change', updateCalculatedPrice);
    
    // Sync initially with whatever city is active in checkout
    if (window.selectedCity) {
        citySelect.value = window.selectedCity;
    }
    updateCalculatedPrice();

    // --- Add to Basket Event Handler ---
    const addToCartBtn = document.getElementById('product-add-to-cart-btn');
    if (addToCartBtn) {
        const newAddToCartBtn = addToCartBtn.cloneNode(true);
        addToCartBtn.parentNode.replaceChild(newAddToCartBtn, addToCartBtn);
        
        newAddToCartBtn.addEventListener('click', () => {
            if (window.addToCart) {
                window.addToCart(product.id);
                
                // Add a visual micro-animation
                const origHtml = newAddToCartBtn.innerHTML;
                newAddToCartBtn.innerHTML = '<i class="fa-solid fa-check"></i> Added!';
                newAddToCartBtn.style.background = 'linear-gradient(135deg, var(--primary-green-light) 0%, var(--primary-green) 100%)';
                setTimeout(() => {
                    newAddToCartBtn.innerHTML = origHtml;
                    newAddToCartBtn.style.background = '';
                }, 1200);

                if (window.openCartDrawer) {
                    window.openCartDrawer();
                }
            }
        });
    }

    // --- Buy Now Event Handler ---
    const buyNowBtn = document.getElementById('product-buy-now-btn');
    if (buyNowBtn) {
        const newBuyNowBtn = buyNowBtn.cloneNode(true);
        buyNowBtn.parentNode.replaceChild(newBuyNowBtn, buyNowBtn);
        
        newBuyNowBtn.addEventListener('click', () => {
            if (window.addToCart && window.openCheckoutWizard) {
                window.addToCart(product.id);
                window.openCheckoutWizard();
            }
        });
    }
};
