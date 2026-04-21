from selenium import webdriver
from selenium.webdriver.common.by import By
import time
import json

options = webdriver.ChromeOptions()
options.add_argument('--headless')
options.add_experimental_option('w3c', True)
options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
driver = webdriver.Chrome(options=options)

try:
    print("Navigating to shop...")
    driver.get("http://localhost:8000/shop.html")
    time.sleep(2)
    
    # Run script to set a mock item in cart so we don't have to navigate via clicks
    driver.execute_script("""
    localStorage.setItem('kwabz_cart', JSON.stringify([{
        product_id: 'test_product',
        name: 'Test Product',
        price: 100,
        quantity: 1,
        image_url: 'test.png',
        seller_id: 'main'
    }]));
    """)
    
    print("Navigating to checkout...")
    driver.get("http://localhost:8000/checkout.html")
    time.sleep(2)
    
    # Fill form
    driver.execute_script("""
    document.getElementById('customerName').value = 'John Doe';
    document.getElementById('customerPhone').value = '+233 24 123 4567';
    document.getElementById('customerAddress').value = '123 Main St';
    """)
    
    # Click place order
    print("Clicking place order...")
    driver.execute_script("placeOrder();")
    time.sleep(3)
    
    logs = driver.get_log('browser')
    print("BROWSER LOGS:")
    for log in logs:
        print(log)
except Exception as e:
    print("ERROR:", e)
finally:
    driver.quit()
